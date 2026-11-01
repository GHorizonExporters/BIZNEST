const {app,BrowserWindow,ipcMain,dialog}=require('electron');
const path=require('path'),fs=require('fs'),crypto=require('crypto');
const Database=require('better-sqlite3'),os=require('os');
const dataDir=path.join(app.getPath('appData'),'BIZNEST','Data'),bak=path.join(dataDir,'Backups'),dbFile=path.join(dataDir,'biznest.db');
const imgDir=path.join(dataDir,'Images');fs.mkdirSync(bak,{recursive:true});fs.mkdirSync(imgDir,{recursive:true});
let db=new Database(dbFile),S=null;
const d=()=>new Date(Date.now()-new Date().getTimezoneOffset()*6e4).toISOString(),now=()=>d().slice(0,16).replace('T',' ');
// Versioned migrations: append new SQL to this array for future updates (never recreate the DB).
const MIG=[`
create table users(id integer primary key,username text unique,hash text,role text,active int default 1);
create table settings(k text primary key,v text);
create table categories(id integer primary key,name text not null,parent_id integer);
create table products(id integer primary key,sku text,barcode text,name text not null,description text,category_id integer,purchase_price real default 0,sell_price real default 0,wholesale_price real default 0,gst real default 0,stock real default 0,min_stock real default 0);
create table suppliers(id integer primary key,name text not null,gst_no text,phone text,email text,address text);
create table customers(id integer primary key,name text not null,phone text,address text,credit real default 0);
create table sales(id integer primary key,date text,customer_id integer,subtotal real,discount real,gst real,total real,payment text,paid real,user text);
create table sale_items(id integer primary key,sale_id integer,product_id integer,name text,qty real,price real,cost real,gst real);
create table purchases(id integer primary key,date text,supplier_id integer,total real,paid real);
create table purchase_items(id integer primary key,purchase_id integer,product_id integer,qty real,cost real);
create table expenses(id integer primary key,date text,category text,amount real,note text);
create table stock_ledger(id integer primary key,date text,product_id integer,qty real,type text,ref text);
create index ix_p on products(name);create index ix_s on sales(date);`,`
alter table products add column image text;
create table devices(uuid text primary key,name text,os text,token text,last_seen text);
create table sale_returns(id integer primary key,date text,sale_id integer,total real,user text);
create table return_items(id integer primary key,return_id integer,sale_item_id integer,product_id integer,name text,qty real,price real,gst real);
create table payments(id integer primary key,date text,party_type text,party_id integer,amount real,note text);`];
function migrate(){const v=db.pragma('user_version',{simple:true});
 if(v>0&&v<MIG.length)fs.copyFileSync(dbFile,path.join(bak,`pre-migration-v${v}.db`));
 for(let i=v;i<MIG.length;i++)db.transaction(()=>{db.exec(MIG[i]);db.pragma('user_version = '+(i+1))})()}
const T={categories:['name','parent_id'],products:['sku','barcode','name','description','category_id','purchase_price','sell_price','wholesale_price','gst','stock','min_stock','image'],suppliers:['name','gst_no','phone','email','address'],customers:['name','phone','address','credit'],expenses:['date','category','amount','note']};
const hash=p=>{const s=crypto.randomBytes(16).toString('hex');return s+':'+crypto.scryptSync(p,s,64).toString('hex')};
const check=(p,h)=>{const[s,x]=h.split(':');return crypto.timingSafeEqual(crypto.scryptSync(p,s,64),Buffer.from(x,'hex'))};
const settings=()=>Object.fromEntries(all('select * from settings').map(r=>[r.k,r.v]));
const need=(...r)=>{if(!r.includes(S.role))throw new Error('Not allowed for your role')};
const one=(q,...a)=>db.prepare(q).get(...a),all=(q,...a)=>db.prepare(q).all(...a),run=(q,...a)=>db.prepare(q).run(...a);
const led=(pid,q,t,ref)=>run('insert into stock_ledger(date,product_id,qty,type,ref) values(?,?,?,?,?)',now(),pid,q,t,ref);
const REP={
sales:"select s.id,s.date,coalesce(c.name,'Walk-in') customer,s.subtotal,s.discount,s.gst,s.total,s.payment from sales s left join customers c on c.id=s.customer_id where substr(s.date,1,10) between ? and ? order by s.id desc",
products:"select i.name product,sum(i.qty) qty,sum(i.qty*i.price) revenue,sum(i.qty*(i.price-i.cost)) profit from sale_items i join sales s on s.id=i.sale_id where substr(s.date,1,10) between ? and ? group by i.name order by revenue desc",
categories:"select coalesce(c.name,'Uncategorised') category,sum(i.qty) qty,sum(i.qty*i.price) revenue from sale_items i join sales s on s.id=i.sale_id left join products p on p.id=i.product_id left join categories c on c.id=p.category_id where substr(s.date,1,10) between ? and ? group by 1",
purchases:"select p.id,p.date,s.name supplier,p.total,p.paid from purchases p left join suppliers s on s.id=p.supplier_id where substr(p.date,1,10) between ? and ? order by p.id desc",
returns:"select r.id,r.date,r.sale_id,r.total,r.user from sale_returns r where substr(r.date,1,10) between ? and ? order by r.id desc",
expenses:"select date,category,amount,note from expenses where date between ? and ? order by date desc",
gst:"select substr(date,1,10) date,sum(subtotal) taxable,sum(gst) gst,sum(total) total from sales where substr(date,1,10) between ? and ? group by 1 order by 1 desc",
inventory:"select name product,stock,purchase_price cost,stock*purchase_price value from products order by name",
ledger:"select l.date,p.name product,l.qty,l.type,l.ref from stock_ledger l left join products p on p.id=l.product_id where substr(l.date,1,10) between ? and ? order by l.id desc limit 500"};
const H={
hasUsers:()=>one('select count(*) v from users').v>0,
setup:({biz,username,password})=>{if(one('select count(*) v from users').v)throw new Error('Already set up');run('insert into users(username,hash,role) values(?,?,?)',username,hash(password),'owner');run("insert or replace into settings values('biz',?)",biz)},
login:({username,password})=>{const u=one('select * from users where username=? and active=1',username);if(!u||!check(password,u.hash))throw new Error('Invalid username or password');S={username:u.username,role:u.role};return S},
logout:()=>{S=null},
list:({t})=>{if(t==='products')return all('select p.*,c.name category from products p left join categories c on c.id=p.category_id order by p.name');
 if(t==='categories')return all('select c.*,p.name parent from categories c left join categories p on p.id=c.parent_id order by c.name');
 if(t==='suppliers')return all("select s.*,coalesce((select sum(total-paid) from purchases where supplier_id=s.id),0)-coalesce((select sum(amount) from payments where party_type='supplier' and party_id=s.id),0) outstanding from suppliers s order by s.id desc");
 if(!T[t])throw new Error('bad table');return all(`select * from ${t} order by id desc`)},
save:({t,row})=>{const c=T[t];if(!c)throw new Error('bad table');if(t==='expenses'&&!row.date)row.date=d().slice(0,10);
 if(row.id)run(`update ${t} set ${c.map(k=>k+'=?').join(',')} where id=?`,...c.map(k=>row[k]??null),row.id);
 else run(`insert into ${t}(${c.join(',')}) values(${c.map(()=>'?').join(',')})`,...c.map(k=>row[k]??null))},
remove:({t,id})=>{if(t==='users'){need('owner','admin');run("delete from users where id=? and role!='owner'",id)}else if(T[t])run(`delete from ${t} where id=?`,id);else throw new Error('bad table')},
listUsers:()=>{need('owner','admin');return all('select id,username,role,active from users')},
addUser:({row})=>{need('owner','admin');if(row.id){run("update users set role=? where id=? and role!='owner'",row.role,row.id);if(row.password)run("update users set hash=? where id=? and role!='owner'",hash(row.password),row.id)}
 else{if(!row.password)throw new Error('Password required');run('insert into users(username,hash,role) values(?,?,?)',row.username,hash(row.password),row.role)}},
adjust:({id,qty,type})=>{let q=+qty;q=type==='Stock In'?Math.abs(q):(type==='Stock Out'||type==='Damage')?-Math.abs(q):q;
 db.transaction(()=>{run('update products set stock=stock+? where id=?',q,id);led(id,q,type,'ADJ')})()},
sale:({customer_id,items,discount=0,payment,paid})=>db.transaction(()=>{let sub=0,gst=0;
 const lines=items.map(i=>{const p=one('select * from products where id=?',i.product_id);if(!p)throw new Error('Product missing');
  if(p.stock<i.qty)throw new Error(`Insufficient stock: ${p.name} (${p.stock} left)`);
  const tx=i.qty*i.price-(i.disc||0);sub+=tx;gst+=tx*p.gst/100;return{p,i}});
 const total=Math.round((sub+gst-discount)*100)/100;
 const id=run('insert into sales(date,customer_id,subtotal,discount,gst,total,payment,paid,user) values(?,?,?,?,?,?,?,?,?)',now(),customer_id,sub,discount,gst,total,payment,paid,S.username).lastInsertRowid;
 for(const{p,i}of lines){run('insert into sale_items(sale_id,product_id,name,qty,price,cost,gst) values(?,?,?,?,?,?,?)',id,p.id,p.name,i.qty,i.price,p.purchase_price,p.gst);
  run('update products set stock=stock-? where id=?',i.qty,p.id);led(p.id,-i.qty,'Sale','S'+id)}
 if(customer_id&&total>paid)run('update customers set credit=credit+? where id=?',total-paid,customer_id);
 return id})(),
invoice:({id})=>({sale:one('select s.*,c.name customer from sales s left join customers c on c.id=s.customer_id where s.id=?',id),items:all('select * from sale_items where sale_id=?',id),biz:settings()}),
purchase:({supplier_id,items,paid=0})=>db.transaction(()=>{if(!items.length)throw new Error('No items');const total=items.reduce((a,i)=>a+i.qty*i.cost,0);
 const id=run('insert into purchases(date,supplier_id,total,paid) values(?,?,?,?)',now(),supplier_id,total,paid).lastInsertRowid;
 for(const i of items){run('insert into purchase_items(purchase_id,product_id,qty,cost) values(?,?,?,?)',id,i.product_id,i.qty,i.cost);
  run('update products set stock=stock+?,purchase_price=? where id=?',i.qty,i.cost,i.product_id);led(i.product_id,i.qty,'Purchase','P'+id)}return id})(),
purchaseList:()=>all('select p.id,p.date,s.name supplier,p.total,p.paid from purchases p left join suppliers s on s.id=p.supplier_id order by p.id desc limit 100'),
dashboard:()=>{const t=d().slice(0,10),m=t.slice(0,7),v=(q,...a)=>one(q,...a).v||0;
 const rt=x=>v('select sum(total) v from sale_returns where date like ?',x+'%'),month=v('select sum(total) v from sales where date like ?',m+'%')-rt(m),net=v('select sum(total-gst) v from sales where date like ?',m+'%'),
 cogs=v('select sum(i.qty*i.cost) v from sale_items i join sales s on s.id=i.sale_id where s.date like ?',m+'%'),exp=v('select sum(amount) v from expenses where date like ?',m+'%');
 const daily=[6,5,4,3,2,1,0].map(k=>{const x=new Date(Date.now()-new Date().getTimezoneOffset()*6e4-k*864e5).toISOString().slice(0,10);return{d:x,t:v('select sum(total) v from sales where date like ?',x+'%')}});
 return{today:v('select sum(total) v from sales where date like ?',t+'%')-rt(t),month,inv:v('select sum(stock*purchase_price) v from products'),low:v('select count(*) v from products where stock<=min_stock'),
 purch:v('select sum(total) v from purchases where date like ?',m+'%'),exp,profit:net-v('select sum(r.qty*r.price) v from return_items r join sale_returns x on x.id=r.return_id where x.date like ?',m+'%')-cogs+v('select sum(r.qty*i.cost) v from return_items r join sale_items i on i.id=r.sale_item_id join sale_returns x on x.id=r.return_id where x.date like ?',m+'%')-exp,daily,
 top:all('select i.name,sum(i.qty) q,sum(i.qty*i.price) r from sale_items i join sales s on s.id=i.sale_id where s.date like ? group by i.name order by r desc limit 5',m+'%'),
 recent:all('select id,date,total,payment from sales order by id desc limit 8')}},
report:({type,from,to})=>{const q=REP[type];if(!q)throw new Error('bad report');return type==='inventory'?all(q):all(q,from,to)},
getSettings:()=>settings(),
saveSettings:({s})=>{need('owner','admin');for(const k of['biz','address','phone','gstin','footer'])run('insert or replace into settings values(?,?)',k,s[k]||'')},
devices:()=>all('select * from devices order by last_seen desc'),
pickImage:async()=>{const r=await dialog.showOpenDialog({filters:[{name:'Images',extensions:['png','jpg','jpeg','webp']}]});if(r.canceled)return null;const n=Date.now()+path.extname(r.filePaths[0]).toLowerCase();fs.copyFileSync(r.filePaths[0],path.join(imgDir,n));return n},
img:({name})=>{const f=path.join(imgDir,path.basename(name||''));if(!name||!fs.existsSync(f))return null;return 'data:image/'+path.extname(f).slice(1).replace('jpg','jpeg')+';base64,'+fs.readFileSync(f).toString('base64')},
importProducts:({rows})=>db.transaction(()=>{let n=0;for(const r of rows){if(!r.name)continue;let cid=null;
 if(r.category){const c=one('select id from categories where name=?',r.category)||{id:run('insert into categories(name) values(?)',r.category).lastInsertRowid};cid=c.id}
 const v=k=>+r[k]||0,ex=r.sku?one('select id from products where sku=?',r.sku):null;
 if(ex)run('update products set barcode=?,name=?,category_id=?,purchase_price=?,sell_price=?,wholesale_price=?,gst=?,stock=?,min_stock=? where id=?',r.barcode||null,r.name,cid,v('purchase_price'),v('sell_price'),v('wholesale_price'),v('gst'),v('stock'),v('min_stock'),ex.id);
 else run('insert into products(sku,barcode,name,category_id,purchase_price,sell_price,wholesale_price,gst,stock,min_stock) values(?,?,?,?,?,?,?,?,?,?)',r.sku||null,r.barcode||null,r.name,cid,v('purchase_price'),v('sell_price'),v('wholesale_price'),v('gst'),v('stock'),v('min_stock'));n++}return n})(),
pay:({type,id,amount,note})=>db.transaction(()=>{amount=+amount;if(!(amount>0))throw new Error('Enter an amount');
 run('insert into payments(date,party_type,party_id,amount,note) values(?,?,?,?,?)',now(),type,id,amount,note||'');
 if(type==='customer')run('update customers set credit=max(0,credit-?) where id=?',amount,id)})(),
returned:({id})=>all('select sale_item_id,sum(qty) q from return_items where sale_item_id in (select id from sale_items where sale_id=?) group by 1',id),
saleReturn:({sale_id,items})=>db.transaction(()=>{const s=one('select * from sales where id=?',sale_id);if(!s)throw new Error('Invoice not found');let total=0;const rows=[];
 for(const x of items){const q=+x.qty;if(!(q>0))continue;const it=one('select * from sale_items where id=? and sale_id=?',x.item_id,sale_id);if(!it)throw new Error('Bad item');
  const done=one('select sum(qty) v from return_items where sale_item_id=?',it.id).v||0;if(q>it.qty-done)throw new Error(`Cannot return more than sold for ${it.name}`);
  total+=q*it.price*(1+it.gst/100);rows.push([it,q])}
 if(!rows.length)throw new Error('Enter a return quantity');total=Math.round(total*100)/100;
 const rid=run('insert into sale_returns(date,sale_id,total,user) values(?,?,?,?)',now(),sale_id,total,S.username).lastInsertRowid;
 for(const[it,q]of rows){run('insert into return_items(return_id,sale_item_id,product_id,name,qty,price,gst) values(?,?,?,?,?,?,?)',rid,it.id,it.product_id,it.name,q,it.price,it.gst);
  run('update products set stock=stock+? where id=?',q,it.product_id);led(it.product_id,q,'Sales Return','R'+rid)}
 return total})(),
info:()=>({dataDir}),
backup:async()=>{need('owner','admin');const f=path.join(bak,'biznest-'+d().slice(0,16).replace(/[-:T]/g,'')+'.db');await db.backup(f);return f},
restore:async()=>{need('owner','admin');const r=await dialog.showOpenDialog({defaultPath:bak,filters:[{name:'BIZNEST backup',extensions:['db']}]});if(r.canceled)return;
 await db.backup(path.join(bak,'before-restore.db'));db.close();fs.copyFileSync(r.filePaths[0],dbFile);app.relaunch();app.exit()}};
ipcMain.handle('api',async(e,n,a)=>{try{if(!H[n])throw new Error('Unknown action');if(!['hasUsers','setup','login'].includes(n)&&!S)throw new Error('Not logged in');return{data:await H[n](a||{})}}catch(x){return{error:x.message}}});
app.whenReady().then(async()=>{migrate();
 let u=one("select v from settings where k='device'");if(!u){u={v:crypto.randomUUID()};run("insert into settings values('device',?)",u.v)}
 run('insert or replace into devices(uuid,name,os,token,last_seen) values(?,?,?,coalesce((select token from devices where uuid=?),?),?)',u.v,os.hostname(),os.type()+' '+os.release(),u.v,crypto.randomBytes(16).toString('hex'),now());const a='auto-'+d().slice(0,10)+'.db';
 if(!fs.existsSync(path.join(bak,a)))await db.backup(path.join(bak,a));
 fs.readdirSync(bak).filter(f=>f.startsWith('auto-')).sort().slice(0,-30).forEach(f=>fs.unlinkSync(path.join(bak,f)));
 const w=new BrowserWindow({width:1280,height:800,backgroundColor:'#FAFBFA',title:'BIZNEST',webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true}});
 w.setMenuBarVisibility(false);w.loadFile('renderer/index.html')});
app.on('window-all-closed',()=>app.quit());
