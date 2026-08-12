import { jsonResponse } from "../utils/http.js";

export function getDictionaryKeyBundle(env, cacheAllowed, validUntilUtc) {
  const key = (env.DICTIONARY_KEY_V1 || "").trim();
  if (!/^[A-Za-z0-9+/]{43}=$/.test(key)) throw new Error("DICTIONARY_KEY_V1 is missing or invalid");
  return { dictionaryKey: key, dictionaryKeyVersion: 1, dictionaryKeyValidUntilUtc: validUntilUtc, dictionaryKeyCacheAllowed: cacheAllowed };
}

export async function issueTrialDictionaryKey(request, env) {
  let body; try { body = await request.json(); } catch { return jsonResponse({success:false,errorCode:"INVALID_JSON",message:"要求形式が正しくありません。"},400); }
  if (!body || typeof body.deviceHash !== "string" || !/^[a-f0-9]{64}$/.test(body.deviceHash.trim().toLowerCase()))
    return jsonResponse({success:false,errorCode:"INVALID_DEVICE_HASH",message:"端末識別情報が正しくありません。"},400);
  if (typeof body.requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.requestId))
    return jsonResponse({success:false,errorCode:"INVALID_REQUEST_ID",message:"requestIdが正しくありません。"},400);
  const now = new Date();
  const validUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  return jsonResponse({success:true,errorCode:null,serverTimeUtc:now.toISOString(),...getDictionaryKeyBundle(env,false,validUntil),message:null});
}
