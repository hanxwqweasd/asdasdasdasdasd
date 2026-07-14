import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config.js';
import { pool } from '../db.js';
import { withRedisLock } from '../redis.js';

export function runBackupScript(kind:string):Promise<{path:string;size:number;checksum:string}>{
  return new Promise((resolve,reject)=>{const child=spawn('/bin/sh',[path.resolve('scripts/backup.sh'),kind],{env:{...process.env,BACKUP_DIR:config.BACKUP_DIR,BACKUP_RETENTION_DAYS:String(config.BACKUP_RETENTION_DAYS),BACKUP_WEBHOOK_URL:config.BACKUP_WEBHOOK_URL??''}});let stdout='';let stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);child.on('close',async code=>{if(code!==0)return reject(new Error(stderr||`backup exited ${code}`));const file=stdout.trim().split('\n').at(-1)??'';try{const fs=await import('node:fs/promises');const stat=await fs.stat(file);const checksumLine=await fs.readFile(`${file}.sha256`,'utf8');resolve({path:file,size:stat.size,checksum:checksumLine.split(/\s+/)[0]??''});}catch(e){reject(e);}});});
}
export async function createBackup(kind='manual'){const id=crypto.randomUUID();await pool.query(`INSERT INTO backup_runs(id,kind,status) VALUES($1,$2,'running')`,[id,kind]);try{const result=await runBackupScript(kind);await pool.query(`UPDATE backup_runs SET status='completed',path=$2,size_bytes=$3,checksum=$4,completed_at=NOW() WHERE id=$1`,[id,result.path,result.size,result.checksum]);return{id,...result};}catch(error){await pool.query(`UPDATE backup_runs SET status='failed',error=$2,completed_at=NOW() WHERE id=$1`,[id,error instanceof Error?error.message:String(error)]);throw error;}}
export function startBackupWorker(logger:FastifyBaseLogger):()=>void{
  if(!config.BACKUP_ENABLED)return()=>{};let lastDate='';const timer=setInterval(()=>{const now=new Date();const date=now.toISOString().slice(0,10);if(now.getUTCHours()!==config.BACKUP_HOUR_UTC||lastDate===date)return;void withRedisLock(`backup:${date}`,55*60_000,async()=>{lastDate=date;await createBackup('daily');logger.info({date},'Daily PostgreSQL backup completed');}).catch(error=>logger.error({error},'Daily backup failed'));},60_000);timer.unref();return()=>clearInterval(timer);
}
