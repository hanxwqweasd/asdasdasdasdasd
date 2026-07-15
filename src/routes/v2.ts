import crypto from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";
import { AppError } from "../errors.js";
import {
  TUTORIAL_STEPS,
  advanceTutorial,
  tutorialState,
} from "../services/tutorial.js";
import { activeDailyScenario, dailyAction } from "../services/daily.js";
import {
  addBuildingPost,
  buildingSnapshot,
  castBuildingVote,
  ensureBuildingMembership,
  storageTransfer,
} from "../services/building.js";
import { ROLES, chooseRole, getRole } from "../services/roles.js";
import { playerStorylines } from "../services/storylines.js";
import {
  claimCollection,
  collectionsSnapshot,
} from "../services/collections.js";
import {
  buyListing,
  cancelListing,
  cancelOrder,
  createListing,
  createOrder,
  marketSnapshot,
} from "../services/market.js";
import {
  executeIdempotent,
  operationKey,
  assertActionLimit,
} from "../security/anti-abuse.js";
import {
  assertCanCommunicate,
  createReport,
  moderateText,
} from "../services/moderation.js";
import {
  createTicket,
  addUserMessage,
  userTickets,
} from "../services/support.js";
import { assignmentsFor, trackEvent } from "../services/analytics.js";
import { createGiftInvoice, restorePurchase } from "../telegram.js";
import { config } from "../config.js";
import { getSetting } from "../settings.js";
import {
  signalRitualState,
  submitSignalRitual,
} from "../services/signal-ritual.js";

function userOf(request: FastifyRequest) {
  return (
    request as FastifyRequest & {
      telegramUser: { id: number; first_name: string };
    }
  ).telegramUser;
}
const uuid = z.string().uuid();
export async function v2Routes(app: FastifyInstance): Promise<void> {
  app.get("/api/v2/bootstrap", async (request) => {
    const user = userOf(request);
    const [
      tutorial,
      daily,
      building,
      role,
      storylines,
      collections,
      purchases,
      gifts,
      support,
      experiments,
      activeCoop,
    ] = await Promise.all([
      tutorialState(user.id),
      activeDailyScenario(user.id),
      buildingSnapshot(user.id),
      getRole(user.id),
      playerStorylines(user.id),
      collectionsSnapshot(user.id),
      pool.query(
        `SELECT p.id,p.sku,s.title,p.stars,p.status,p.metadata,p.created_at,p.fulfilled_at,p.telegram_charge_id IS NOT NULL confirmed,pf.revoked_at FROM purchases p LEFT JOIN shop_products s ON s.sku=p.sku LEFT JOIN purchase_fulfillments pf ON pf.purchase_id=p.id WHERE p.user_id=$1 ORDER BY p.created_at DESC LIMIT 100`,
        [user.id],
      ),
      pool.query(
        `SELECT g.id,g.sku,s.title,g.message,g.anonymous,g.status,g.created_at,g.claimed_at,CASE WHEN g.anonymous THEN NULL ELSE u.first_name END sender_name FROM gifts g LEFT JOIN users u ON u.id=g.sender_id LEFT JOIN shop_products s ON s.sku=g.sku WHERE g.target_id=$1 ORDER BY g.created_at DESC LIMIT 50`,
        [user.id],
      ),
      userTickets(user.id),
      assignmentsFor(user.id),
      pool.query(
        `SELECT m.id,m.code,m.status,m.updated_at FROM coop_matches m JOIN coop_members c ON c.match_id=m.id WHERE c.user_id=$1 AND m.status IN ('lobby','playing') ORDER BY m.updated_at DESC LIMIT 1`,
        [user.id],
      ),
    ]);
    return {
      tutorial: { ...tutorial, steps: TUTORIAL_STEPS },
      daily,
      building,
      role,
      roles: ROLES,
      storylines,
      collections,
      purchases: purchases.rows,
      gifts: gifts.rows,
      support,
      experiments,
      activeCoop: activeCoop.rows[0] ?? null,
      appVersion: config.APP_VERSION,
    };
  });

  app.get("/api/ritual/signal", async (request) =>
    signalRitualState(userOf(request).id),
  );
  app.post("/api/ritual/signal", async (request) => {
    const user = userOf(request);
    await assertActionLimit(user.id, "signal_ritual", 8, 3600);
    const body = z
      .object({ answer: z.array(z.number().int().min(0).max(1)).length(5) })
      .parse(request.body);
    return submitSignalRitual(user.id, body.answer);
  });

  app.get("/api/tutorial", async (request) =>
    tutorialState(userOf(request).id),
  );
  app.post("/api/tutorial/action", async (request) => {
    const user = userOf(request);
    const body = z
      .object({
        action: z.enum(
          TUTORIAL_STEPS.map((x) => x.action) as [string, ...string[]],
        ),
      })
      .parse(request.body);
    return advanceTutorial(user.id, body.action as any);
  });

  app.get("/api/daily", async (request) =>
    activeDailyScenario(userOf(request).id),
  );
  app.post("/api/daily/:id/action", async (request) => {
    const user = userOf(request);
    const params = z.object({ id: uuid }).parse(request.params);
    const body = z
      .object({
        action: z.string().min(1).max(50),
        operationId: z.string().optional(),
      })
      .parse(request.body);
    const key = operationKey(request, body);
    return executeIdempotent(user.id, "daily", key, body, () =>
      dailyAction(user.id, params.id, body.action),
    );
  });

  app.get("/api/building", async (request) =>
    buildingSnapshot(userOf(request).id),
  );
  app.post("/api/building/posts", async (request) => {
    const user = userOf(request);
    await assertCanCommunicate(user.id);
    await assertActionLimit(user.id, "building_post", 8, 3600);
    const body = z
      .object({ body: z.string().trim().min(1).max(500) })
      .parse(request.body);
    const checked = await moderateText(user.id, body.body, {
      entity: "building_post",
    });
    if (checked.hidden)
      throw new AppError(
        "Запись отправлена на проверку и пока не опубликована",
        202,
        "MESSAGE_UNDER_REVIEW",
      );
    return addBuildingPost(user.id, checked.text);
  });
  app.post("/api/building/storage", async (request) => {
    const user = userOf(request);
    const body = z
      .object({
        itemId: z.string().min(1).max(80),
        quantity: z.number().int().min(1).max(100),
        direction: z.enum(["deposit", "withdraw"]),
        operationId: z.string().optional(),
      })
      .parse(request.body);
    const key = operationKey(request, body);
    return executeIdempotent(user.id, "building-storage", key, body, () =>
      storageTransfer(user.id, body.itemId, body.quantity, body.direction, key),
    );
  });
  app.post("/api/building/votes/:id", async (request) => {
    const user = userOf(request);
    const params = z.object({ id: uuid }).parse(request.params);
    const body = z
      .object({ optionKey: z.string().min(1).max(80) })
      .parse(request.body);
    return castBuildingVote(user.id, params.id, body.optionKey);
  });
  app.post("/api/building/votes", async (request) => {
    const user = userOf(request);
    const body = z
      .object({
        kind: z.enum(["decision", "elder"]),
        title: z.string().min(3).max(120),
        description: z.string().min(3).max(500),
        options: z
          .array(
            z.object({
              key: z.string().min(1).max(80),
              label: z.string().min(1).max(120),
            }),
          )
          .min(2)
          .max(8),
        hours: z.number().int().min(1).max(168).default(24),
      })
      .parse(request.body);
    const buildingId = await ensureBuildingMembership(user.id);
    const allowed = await pool.query(
      `SELECT (b.elder_user_id=$2 OR p.profession='chairman') allowed FROM buildings b JOIN player_profiles p ON p.user_id=$2 WHERE b.id=$1`,
      [buildingId, user.id],
    );
    if (!allowed.rows[0]?.allowed)
      throw new AppError(
        "Создавать голосования может председатель или старший подъезда",
        403,
        "VOTE_CREATE_FORBIDDEN",
      );
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO building_votes(id,building_id,created_by,kind,title,description,options,closes_at) VALUES($1,$2,$3,$4,$5,$6,$7,NOW()+($8::text||' hours')::interval)`,
      [
        id,
        buildingId,
        user.id,
        body.kind,
        body.title,
        body.description,
        JSON.stringify(body.options),
        body.hours,
      ],
    );
    return { id };
  });

  app.get("/api/roles", async (request) => ({
    current: await getRole(userOf(request).id),
    roles: ROLES,
  }));
  app.post("/api/roles/:role", async (request) => {
    const user = userOf(request);
    const { role } = z
      .object({
        role: z.enum(
          Object.keys(ROLES) as [
            keyof typeof ROLES,
            ...Array<keyof typeof ROLES>,
          ],
        ),
      })
      .parse(request.params);
    return chooseRole(user.id, role);
  });
  app.get("/api/storylines", async (request) => ({
    items: await playerStorylines(userOf(request).id),
  }));
  app.post("/api/storylines/:id/choice", async (request) => {
    const user = userOf(request);
    const { id } = z.object({ id: uuid }).parse(request.params);
    const body = z
      .object({ choice: z.string().min(1).max(80) })
      .parse(request.body);
    const story = await pool.query(
      `SELECT slug,jsonb_array_length(chapters) chapter_count FROM storylines WHERE id=$1`,
      [id],
    );
    if (!story.rows[0])
      throw new AppError("История не найдена", 404, "STORYLINE_NOT_FOUND");
    const found = await pool.query(
      `UPDATE storyline_assignments SET chapter=chapter+1,state=state||$3::jsonb,completed_at=CASE WHEN chapter+1>=$4-1 THEN NOW() ELSE completed_at END WHERE storyline_id=$1 AND user_id=$2 RETURNING chapter,completed_at`,
      [
        id,
        user.id,
        JSON.stringify({ [`chapter_${Date.now()}`]: body.choice }),
        Number(story.rows[0].chapter_count),
      ],
    );
    if (!found.rows[0])
      throw new AppError("История не найдена", 404, "STORYLINE_NOT_FOUND");
    if (found.rows[0].completed_at && story.rows[0].slug === "photographer")
      await pool.query(
        `INSERT INTO user_achievements(achievement_id,user_id,context) SELECT id,$1,$2 FROM achievements WHERE slug='old-photo-self' ON CONFLICT DO NOTHING`,
        [user.id, JSON.stringify({ storylineId: id })],
      );
    return found.rows[0];
  });

  app.get("/api/market", async (request) => {
    if (!(await getSetting<boolean>("market_enabled", true)))
      throw new AppError("Рынок временно закрыт", 503, "MARKET_DISABLED");
    const q = z
      .object({ itemId: z.string().max(80).optional() })
      .parse(request.query);
    return marketSnapshot(userOf(request).id, q.itemId);
  });
  app.post("/api/market/listings", async (request) => {
    const user = userOf(request);
    const body = z
      .object({
        itemId: z.string().min(1).max(80),
        quantity: z.number().int().min(1).max(1000),
        price: z.number().int().min(1).max(100000),
        anonymous: z.boolean().default(false),
        operationId: z.string().optional(),
      })
      .parse(request.body);
    const key = operationKey(request, body);
    return executeIdempotent(user.id, "market-listing", key, body, () =>
      createListing(
        user.id,
        body.itemId,
        body.quantity,
        body.price,
        body.anonymous,
        key,
      ),
    );
  });
  app.post("/api/market/listings/:id/buy", async (request) => {
    const user = userOf(request);
    const { id } = z.object({ id: uuid }).parse(request.params);
    const body = z
      .object({
        quantity: z.number().int().min(1).max(1000),
        operationId: z.string().optional(),
      })
      .parse(request.body);
    const key = operationKey(request, body);
    return executeIdempotent(user.id, "market-buy", key, { id, ...body }, () =>
      buyListing(user.id, id, body.quantity, key),
    );
  });
  app.delete("/api/market/listings/:id", async (request) => {
    const user = userOf(request);
    const { id } = z.object({ id: uuid }).parse(request.params);
    const key = operationKey(request, request.body as any);
    return executeIdempotent(
      user.id,
      "market-cancel-listing",
      key,
      { id },
      () => cancelListing(user.id, id, key),
    );
  });
  app.post("/api/market/orders", async (request) => {
    const user = userOf(request);
    const body = z
      .object({
        itemId: z.string().min(1).max(80),
        quantity: z.number().int().min(1).max(1000),
        maxPrice: z.number().int().min(1).max(100000),
        operationId: z.string().optional(),
      })
      .parse(request.body);
    const key = operationKey(request, body);
    return executeIdempotent(user.id, "market-order", key, body, () =>
      createOrder(user.id, body.itemId, body.quantity, body.maxPrice, key),
    );
  });
  app.delete("/api/market/orders/:id", async (request) => {
    const user = userOf(request);
    const { id } = z.object({ id: uuid }).parse(request.params);
    const key = operationKey(request, request.body as any);
    return executeIdempotent(user.id, "market-cancel-order", key, { id }, () =>
      cancelOrder(user.id, id, key),
    );
  });

  app.get("/api/collections", async (request) =>
    collectionsSnapshot(userOf(request).id),
  );
  app.post("/api/collections/:id/claim", async (request) => {
    const user = userOf(request);
    const { id } = z.object({ id: uuid }).parse(request.params);
    return claimCollection(user.id, id);
  });

  app.get("/api/purchases", async (request) => ({
    items: (
      await pool.query(
        `SELECT p.id,p.sku,s.title,s.description,p.stars,p.status,p.metadata,p.created_at,p.fulfilled_at,pf.revoked_at FROM purchases p LEFT JOIN shop_products s ON s.sku=p.sku LEFT JOIN purchase_fulfillments pf ON pf.purchase_id=p.id WHERE p.user_id=$1 ORDER BY p.created_at DESC`,
        [userOf(request).id],
      )
    ).rows,
    refundRules:
      "Возврат подтверждённых Stars выполняется поддержкой или администратором. После возврата выданный контент отзывается.",
  }));
  app.post("/api/purchases/:id/restore", async (request) => {
    const user = userOf(request);
    const { id } = z.object({ id: uuid }).parse(request.params);
    return restorePurchase(user.id, id);
  });
  app.post("/api/gifts/:sku/invoice", async (request) => {
    const user = userOf(request);
    const { sku } = z
      .object({ sku: z.string().min(1).max(60) })
      .parse(request.params);
    const body = z
      .object({
        targetId: z.coerce.number().int().positive(),
        message: z.string().max(160).default(""),
        anonymous: z.boolean().default(false),
      })
      .parse(request.body);
    return createGiftInvoice(
      user.id,
      body.targetId,
      sku,
      body.message,
      body.anonymous,
    );
  });
  app.post("/api/gifts/:id/claim", async (request) => {
    const user = userOf(request);
    const { id } = z.object({ id: uuid }).parse(request.params);
    const result = await pool.query(
      `UPDATE gifts SET status='claimed',claimed_at=NOW() WHERE id=$1 AND target_id=$2 AND status='delivered' RETURNING id`,
      [id, user.id],
    );
    if (!result.rowCount)
      throw new AppError("Подарок недоступен", 404, "GIFT_NOT_FOUND");
    return { ok: true };
  });

  app.get("/api/support", async (request) => userTickets(userOf(request).id));
  app.post("/api/support", async (request) => {
    const user = userOf(request);
    const body = z
      .object({
        category: z.enum([
          "payment",
          "bug",
          "account",
          "moderation",
          "idea",
          "other",
        ]),
        subject: z.string().min(3).max(120),
        body: z.string().min(3).max(3000),
        screenshot: z.string().optional(),
        appVersion: z.string().max(40).optional(),
        context: z.record(z.unknown()).optional(),
      })
      .parse(request.body);
    return createTicket(user.id, body);
  });
  app.post("/api/support/:id/messages", async (request) => {
    const user = userOf(request);
    const { id } = z.object({ id: uuid }).parse(request.params);
    const body = z
      .object({
        body: z.string().min(1).max(3000),
        screenshot: z.string().optional(),
      })
      .parse(request.body);
    return addUserMessage(user.id, id, body.body, body.screenshot);
  });
  app.post("/api/reports", async (request) => {
    const user = userOf(request);
    const body = z
      .object({
        targetId: z.string().regex(/^\d+$/),
        entityType: z.enum(["note", "post", "market", "profile"]),
        entityId: z.string().max(100).optional(),
        reason: z.string().min(3).max(80),
        details: z.string().max(1000).optional(),
      })
      .parse(request.body);
    return createReport(
      user.id,
      body.targetId,
      body.entityType,
      body.entityId,
      body.reason,
      body.details,
    );
  });

  app.post("/api/analytics", async (request) => {
    const user = userOf(request);
    const body = z
      .object({
        eventName: z.string().regex(/^[a-z0-9_:-]{2,80}$/),
        properties: z.record(z.unknown()).default({}),
        sessionId: z.string().min(8).max(100).optional(),
        appVersion: z.string().max(40).optional(),
        assignments: z.record(z.string()).default({}),
      })
      .parse(request.body);
    if (JSON.stringify(body.properties).length > 8000)
      throw new AppError(
        "Событие слишком большое",
        413,
        "ANALYTICS_PAYLOAD_TOO_LARGE",
      );
    await trackEvent(
      user.id,
      body.eventName,
      body.properties,
      body.sessionId,
      body.appVersion,
      body.assignments,
    );
    return { ok: true };
  });
  app.post("/api/sessions/:id/end", async (request) => {
    const user = userOf(request);
    const { id } = z
      .object({ id: z.string().min(8).max(100) })
      .parse(request.params);
    await pool.query(
      `UPDATE app_sessions SET ended_at=NOW(),last_seen_at=NOW() WHERE id=$1 AND user_id=$2`,
      [id, user.id],
    );
    return { ok: true };
  });

  app.get("/api/content/:slug", async (request) => {
    const user = userOf(request);
    const { slug } = z
      .object({ slug: z.string().regex(/^[a-z0-9-]+$/) })
      .parse(request.params);
    const result = await pool.query(
      `SELECT d.id,d.title,d.content_type,d.published_version,v.graph,d.test_audience FROM content_documents d JOIN content_versions v ON v.document_id=d.id AND v.version=d.published_version WHERE d.slug=$1 AND d.status='published'`,
      [slug],
    );
    if (!result.rows[0])
      throw new AppError("История не опубликована", 404, "CONTENT_NOT_FOUND");
    const required = `chapter:${slug}`;
    const entitlement = await pool.query(
      `SELECT 1 FROM entitlements WHERE user_id=$1 AND entitlement_key=$2`,
      [user.id, required],
    );
    if (slug !== "onboarding" && !entitlement.rowCount)
      throw new AppError(
        "Для этой истории нужен сюжетный билет",
        403,
        "CONTENT_ENTITLEMENT_REQUIRED",
      );
    return result.rows[0];
  });
}
