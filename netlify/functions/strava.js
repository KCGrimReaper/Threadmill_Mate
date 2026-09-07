// Fonction serverless : échange OAuth + upload vers Strava.
// Le secret vient des variables d'environnement, jamais du code.
const CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const CORS = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'Content-Type', 'Access-Control-Allow-Methods':'POST,OPTIONS' };

export async function handler(event){
  if(event.httpMethod === 'OPTIONS') return { statusCode:200, headers:CORS, body:'' };
  if(event.httpMethod !== 'POST') return { statusCode:405, headers:CORS, body:'POST only' };
  try{
    if(!CLIENT_ID || !CLIENT_SECRET) return { statusCode:500, headers:CORS, body: JSON.stringify({error:'Config manquante : STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET'}) };
    const b = JSON.parse(event.body || '{}');

    // 1) échange du code d'autorisation contre des jetons
    if(b.action === 'exchange'){
      const r = await fetch('https://www.strava.com/oauth/token', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ client_id:CLIENT_ID, client_secret:CLIENT_SECRET, code:b.code, grant_type:'authorization_code' })
      });
      const j = await r.json();
      return { statusCode: r.status, headers:CORS, body: JSON.stringify({
        access_token:j.access_token, refresh_token:j.refresh_token, expires_at:j.expires_at,
        athlete: j.athlete ? { firstname:j.athlete.firstname, lastname:j.athlete.lastname } : null, error:j.errors||j.message }) };
    }

    // 2) upload d'un fichier FIT (rafraîchit le jeton d'abord)
    if(b.action === 'upload'){
      const tr = await fetch('https://www.strava.com/oauth/token', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ client_id:CLIENT_ID, client_secret:CLIENT_SECRET, refresh_token:b.refresh_token, grant_type:'refresh_token' })
      });
      const tj = await tr.json();
      if(!tj.access_token) return { statusCode:401, headers:CORS, body: JSON.stringify({error:'refresh échoué', detail:tj}) };
      const bytes = Buffer.from(b.fileBase64, 'base64');
      const form = new FormData();
      form.append('file', new Blob([bytes]), (b.name||'threadmill')+'.fit');
      form.append('data_type', 'fit');
      if(b.name) form.append('name', b.name);
      if(b.description) form.append('description', b.description);
      const up = await fetch('https://www.strava.com/api/v3/uploads', {
        method:'POST', headers:{ Authorization:'Bearer '+tj.access_token }, body: form });
      const uj = await up.json();
      return { statusCode: up.status, headers:CORS, body: JSON.stringify({ upload:uj, refresh_token: tj.refresh_token }) };
    }
    return { statusCode:400, headers:CORS, body: JSON.stringify({error:'action inconnue'}) };
  }catch(e){ return { statusCode:500, headers:CORS, body: JSON.stringify({error:String(e)}) }; }
}
