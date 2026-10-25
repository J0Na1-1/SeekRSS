import {Database} from 'bun:sqlite';
import {AdminRecovery} from '../src/seekrss/recovery';

// Run only by a trusted server operator. Stdout is a private, short-lived bearer link.
const origin=new URL(process.env.PUBLIC_ORIGIN||'');
if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new Error('PUBLIC_ORIGIN must be an exact HTTPS origin');
const minutes=Number(process.env.RESET_TTL_MINUTES||30);
if(!Number.isInteger(minutes)||minutes<1||minutes>60)throw new Error('RESET_TTL_MINUTES must be 1–60');
const db=new Database(process.env.DATABASE_PATH||'./data/seekrss.db',{create:false});
try{
 db.exec('PRAGMA busy_timeout=5000');
 const issued=new AdminRecovery(db).issue(minutes*60_000);
 const username=(db.query('SELECT username FROM admin WHERE id=1').get() as {username:string}).username;
 console.log(JSON.stringify({url:origin.origin+'/reset#token='+issued.token,username,expires_at:issued.expires_at}));
}finally{db.close();}
