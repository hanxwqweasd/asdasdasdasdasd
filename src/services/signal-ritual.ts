import crypto from "node:crypto";
import { pool, withTransaction } from "../db.js";
import { AppError } from "../errors.js";

export interface SignalRitualState {
  playDate: string;
  pattern: number[];
  attempts: number;
  maxAttempts: number;
  completedAt: string | null;
  reward: { clues: number; marks: number };
}

export function signalPatternFor(userId: number, date: string): number[] {
  const hash = crypto
    .createHash("sha256")
    .update(`${userId}:${date}:eighth-floor-signal`)
    .digest();
  const pattern = Array.from({ length: 5 }, (_, index) => hash[index]! % 2);
  if (pattern.every((value) => value === pattern[0]))
    pattern[2] = pattern[0] === 0 ? 1 : 0;
  return pattern;
}

export async function signalRitualState(
  userId: number,
): Promise<SignalRitualState> {
  const dateResult = await pool.query<{ today: string }>(
    `SELECT CURRENT_DATE::text today`,
  );
  const playDate = dateResult.rows[0]!.today;
  const pattern = signalPatternFor(userId, playDate);
  await pool.query(
    `INSERT INTO signal_ritual_attempts(user_id,play_date,pattern)
    VALUES($1,$2,$3) ON CONFLICT(user_id,play_date) DO NOTHING`,
    [userId, playDate, JSON.stringify(pattern)],
  );
  const found = await pool.query(
    `SELECT play_date::text,pattern,attempts,completed_at FROM signal_ritual_attempts WHERE user_id=$1 AND play_date=$2`,
    [userId, playDate],
  );
  const row = found.rows[0];
  return {
    playDate: row.play_date,
    pattern: Array.isArray(row.pattern) ? row.pattern : pattern,
    attempts: Number(row.attempts),
    maxAttempts: 3,
    completedAt: row.completed_at,
    reward: { clues: 1, marks: 8 },
  };
}

export async function submitSignalRitual(
  userId: number,
  answer: number[],
): Promise<SignalRitualState & { correct: boolean }> {
  return withTransaction(async (client) => {
    const dateResult = await client.query<{ today: string }>(
      `SELECT CURRENT_DATE::text today`,
    );
    const playDate = dateResult.rows[0]!.today;
    const expected = signalPatternFor(userId, playDate);
    await client.query(
      `INSERT INTO signal_ritual_attempts(user_id,play_date,pattern)
      VALUES($1,$2,$3) ON CONFLICT(user_id,play_date) DO NOTHING`,
      [userId, playDate, JSON.stringify(expected)],
    );
    const locked = await client.query(
      `SELECT pattern,attempts,completed_at FROM signal_ritual_attempts WHERE user_id=$1 AND play_date=$2 FOR UPDATE`,
      [userId, playDate],
    );
    const row = locked.rows[0];
    if (row.completed_at)
      return {
        playDate,
        pattern: row.pattern,
        attempts: Number(row.attempts),
        maxAttempts: 3,
        completedAt: row.completed_at,
        reward: { clues: 1, marks: 8 },
        correct: true,
      };
    if (Number(row.attempts) >= 3)
      throw new AppError(
        "Приёмник замолчал до следующей ночи",
        429,
        "SIGNAL_ATTEMPTS_EXHAUSTED",
      );
    const correct =
      answer.length === expected.length &&
      answer.every((value, index) => value === expected[index]);
    const updated = await client.query(
      `UPDATE signal_ritual_attempts SET attempts=attempts+1,completed_at=CASE WHEN $3 THEN NOW() ELSE completed_at END,updated_at=NOW()
      WHERE user_id=$1 AND play_date=$2 RETURNING pattern,attempts,completed_at`,
      [userId, playDate, correct],
    );
    if (correct) {
      const reward = await client.query<{ clues: number; house_marks: number }>(
        `UPDATE player_profiles
         SET clues=clues+1, house_marks=house_marks+8
         WHERE user_id=$1
         RETURNING clues,house_marks`,
        [userId],
      );
      const balances = reward.rows[0];
      if (!balances)
        throw new AppError(
          "Профиль жильца не найден",
          404,
          "PROFILE_NOT_FOUND",
        );

      await client.query(
        `INSERT INTO economy_ledger(user_id,asset_type,asset_key,delta,balance_after,reason,operation_id,metadata)
         VALUES
           ($1,'currency','house_marks',8,$2,'signal_ritual',$4,$5),
           ($1,'progress','clues',1,$3,'signal_ritual',$4,$5)
         ON CONFLICT DO NOTHING`,
        [
          userId,
          Number(balances.house_marks),
          Number(balances.clues),
          `signal:${playDate}`,
          JSON.stringify({ playDate, pattern: expected }),
        ],
      );
      await client.query(
        `INSERT INTO user_achievements(achievement_id,user_id,context)
        SELECT id,$1,$2 FROM achievements WHERE slug='impossible-elevator' ON CONFLICT DO NOTHING`,
        [userId, JSON.stringify({ source: "signal_ritual", playDate })],
      );
    }
    const next = updated.rows[0];
    return {
      playDate,
      pattern: next.pattern,
      attempts: Number(next.attempts),
      maxAttempts: 3,
      completedAt: next.completed_at,
      reward: { clues: 1, marks: 8 },
      correct,
    };
  });
}
