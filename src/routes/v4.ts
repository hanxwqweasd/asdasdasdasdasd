import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../errors.js';
import {
 acknowledgeAnomaly, activeLiveNight, advancePremiumContent, antagonistIntervention, applyPremiumInterior, biometricState, chatCases, contributeLiveNight,
 createMotionChallenge, createUserRoom, deleteVoiceClip, emojiStatuses, enrollBiometric, joinChatCase,
 markEmojiAccess, markHomeScreen, paymentRecoveryState, paymentSupport, playUserRoom, prepareChatCase,
 prepareShareCard, premiumContent, recordRoomTrace, relationshipEvent, relationships, rememberArchive, reviewUserRoom,
 roomTraces, saveVoiceClip, seasonArchive, submitUserRoom, unlockBiometric, userRooms, v4Snapshot,
 verifyMotionChallenge, voiceClip, voiceLibrary
} from '../services/v4.js';
import { assertActionLimit } from '../security/anti-abuse.js';
import { assertCanCommunicate, moderateText } from '../services/moderation.js';

function userOf(request:FastifyRequest){return (request as FastifyRequest&{telegramUser:{id:number;first_name:string}}).telegramUser;}
const uuid=z.string().uuid();
export async function v4Routes(app:FastifyInstance){
 app.get('/api/v4/bootstrap',async request=>v4Snapshot(userOf(request).id));
 app.get('/api/v4/traces/:roomId',async request=>{const{roomId}=z.object({roomId:z.string().min(1).max(120)}).parse(request.params);return{items:await roomTraces(roomId,userOf(request).id)};});
 app.post('/api/v4/traces',async request=>{const u=userOf(request);await assertActionLimit(u.id,'trace',15,3600);const b=z.object({roomId:z.string().min(1).max(120),type:z.enum(['silhouette','sound','message','object','camera','warning']),payload:z.record(z.unknown()).default({})}).parse(request.body);return recordRoomTrace(u.id,b.roomId,b.type,b.payload);});
 app.get('/api/v4/relationships',async request=>({items:await relationships(userOf(request).id)}));
 app.post('/api/v4/relationships/:otherId',async request=>{const u=userOf(request);const{otherId}=z.object({otherId:z.coerce.number().int().positive()}).parse(request.params);const b=z.object({kind:z.enum(['help','abandon','trust','debt','secret']),context:z.record(z.unknown()).default({})}).parse(request.body);await relationshipEvent(u.id,otherId,b.kind,b.context);return{ok:true};});
 app.post('/api/v4/share',async request=>{const u=userOf(request);const b=z.object({kind:z.string().min(1).max(40),title:z.string().min(2).max(120),subtitle:z.string().max(200),facts:z.array(z.string().max(120)).max(5)}).parse(request.body);return prepareShareCard(u.id,b);});
 app.get('/api/v4/chat-cases',async request=>({items:await chatCases(userOf(request).id)}));
 app.post('/api/v4/chat-cases/prepare',async request=>{const b=z.object({scenarioKey:z.string().regex(/^[a-z0-9-]+$/).default('missing-tenant')}).parse(request.body??{});return prepareChatCase(userOf(request).id,b.scenarioKey);});
 app.post('/api/v4/chat-cases/join',async request=>{const b=z.object({code:z.string().min(5).max(20)}).parse(request.body);return joinChatCase(userOf(request).id,b.code);});
 app.get('/api/v4/live-night',async request=>activeLiveNight(userOf(request).id));
 app.post('/api/v4/live-night/contribute',async request=>{const u=userOf(request);await assertActionLimit(u.id,'live_night',30,3600);const b=z.object({amount:z.number().int().min(1).max(20),fragment:z.string().min(1).max(80)}).parse(request.body);return contributeLiveNight(u.id,b.amount,b.fragment);});
 app.post('/api/v4/antagonist/action',async request=>{const b=z.object({action:z.enum(['forge_notice','lock_room','move_item','false_vote'])}).parse(request.body);return antagonistIntervention(userOf(request).id,b.action);});
 app.post('/api/v4/motion',async request=>{const b=z.object({type:z.enum(['tilt','still','peephole','tune'])}).parse(request.body);return createMotionChallenge(userOf(request).id,b.type);});
 app.post('/api/v4/motion/:id/verify',async request=>{const{id}=z.object({id:uuid}).parse(request.params);const b=z.object({result:z.record(z.unknown()).default({}),fallbackCode:z.string().optional()}).parse(request.body);return verifyMotionChallenge(userOf(request).id,id,b.result,b.fallbackCode);});
 app.get('/api/v4/biometric',async request=>biometricState(userOf(request).id));
 app.post('/api/v4/biometric/enroll',async request=>{const b=z.object({deviceId:z.string().min(3).max(200),biometricToken:z.string().min(8).max(2048)}).parse(request.body);return enrollBiometric(userOf(request).id,b.deviceId,b.biometricToken);});
 app.post('/api/v4/biometric/unlock',async request=>{const b=z.object({biometricToken:z.string().optional(),recoveryCode:z.string().optional()}).refine(x=>x.biometricToken||x.recoveryCode).parse(request.body);return unlockBiometric(userOf(request).id,b.biometricToken,b.recoveryCode);});
 app.post('/api/v4/home-screen',async request=>{const b=z.object({kind:z.enum(['prompted','added'])}).parse(request.body);return markHomeScreen(userOf(request).id,b.kind);});
 app.get('/api/v4/emoji-statuses',async request=>emojiStatuses(userOf(request).id));
 app.post('/api/v4/emoji-statuses/access',async request=>{const b=z.object({allowed:z.boolean()}).parse(request.body);return markEmojiAccess(userOf(request).id,b.allowed);});
 app.post('/api/v4/anomalies/:id/ack',async request=>{const{id}=z.object({id:uuid}).parse(request.params);return acknowledgeAnomaly(userOf(request).id,id);});
 app.get('/api/v4/voices',async request=>voiceLibrary(userOf(request).id));
 app.post('/api/v4/voices',async request=>{const u=userOf(request);await assertActionLimit(u.id,'voice_clip',5,86400);const b=z.object({phraseKey:z.enum(['dont_open','im_here','lift_arrived','not_my_flat','look_back']),mimeType:z.string().max(80),audioBase64:z.string().min(100).max(700000),durationMs:z.number().int().min(300).max(4000),consent:z.literal(true)}).parse(request.body);return saveVoiceClip(u.id,b);});
 app.get('/api/v4/voices/:id/audio',async(request,reply)=>{const{id}=z.object({id:uuid}).parse(request.params);const clip=await voiceClip(id,userOf(request).id);return reply.header('cache-control','private, max-age=300').type(clip.mime_type).send(clip.audio);});
 app.delete('/api/v4/voices/:id',async request=>{const{id}=z.object({id:uuid}).parse(request.params);return deleteVoiceClip(userOf(request).id,id);});
 app.get('/api/v4/user-rooms',async request=>({items:await userRooms(userOf(request).id)}));
 app.post('/api/v4/user-rooms',async request=>{const u=userOf(request);await assertActionLimit(u.id,'user_room',5,86400);await assertCanCommunicate(u.id);const b=z.object({title:z.string().min(3).max(80),layout:z.enum(['corridor','flat','archive','utility']).default('corridor'),components:z.array(z.string()).min(2).max(8),sound:z.string(),light:z.enum(['flicker','warm','cold','dark']).default('flicker'),puzzle:z.enum(['sequence','sound','difference','choice']).default('sequence'),choices:z.array(z.object({label:z.string().min(2).max(60),outcome:z.string().min(4).max(160)})).min(2).max(3)}).parse(request.body);const moderation=await moderateText(u.id,[b.title,...b.choices.flatMap(x=>[x.label,x.outcome])].join(' · '),{surface:'user_room'});if(moderation.hidden)throw new AppError('Комната отправлена на дополнительную проверку текста',422,'CONTENT_MODERATION_REQUIRED');return createUserRoom(u.id,b);});
 app.post('/api/v4/user-rooms/:id/submit',async request=>{const{id}=z.object({id:uuid}).parse(request.params);return submitUserRoom(userOf(request).id,id);});
 app.post('/api/v4/user-rooms/:id/play',async request=>{const{id}=z.object({id:uuid}).parse(request.params);return playUserRoom(userOf(request).id,id);});
 app.post('/api/v4/user-rooms/:id/review',async request=>{const{id}=z.object({id:uuid}).parse(request.params);const b=z.object({liked:z.boolean()}).parse(request.body);return reviewUserRoom(userOf(request).id,id,b.liked);});
 app.get('/api/v4/season-archive',async request=>({seasons:await seasonArchive(userOf(request).id)}));
 app.post('/api/v4/season-archive/:id/remember',async request=>{const{id}=z.object({id:uuid}).parse(request.params);const b=z.object({state:z.record(z.unknown()).default({})}).parse(request.body);return rememberArchive(userOf(request).id,id,b.state);});
 app.get('/api/v4/premium-content',async request=>({items:await premiumContent(userOf(request).id)}));
 app.post('/api/v4/content/:slug/advance',async request=>{const{slug}=z.object({slug:z.string().regex(/^[a-z0-9-]+$/)}).parse(request.params);const b=z.object({fromNodeId:z.string().min(1).max(120),toNodeId:z.string().min(1).max(120)}).parse(request.body);return advancePremiumContent(userOf(request).id,slug,b.fromNodeId,b.toNodeId);});
 app.post('/api/v4/interiors/:contentKey/apply',async request=>{const{contentKey}=z.object({contentKey:z.string().regex(/^interior-[a-z0-9-]+$/)}).parse(request.params);return applyPremiumInterior(userOf(request).id,contentKey);});
 app.get('/api/v4/payment-history',async request=>({items:await paymentRecoveryState(userOf(request).id)}));
 app.post('/api/v4/payment-support',async request=>{const b=z.object({purchaseId:uuid.optional(),body:z.string().min(5).max(1000)}).parse(request.body);return paymentSupport(userOf(request).id,b.purchaseId,b.body);});
}
