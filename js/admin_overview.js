document.addEventListener('DOMContentLoaded', async () => {
 const sb=window.supabaseClient;if(!sb)return;
 const {data:{user}}=await sb.auth.getUser();if(!user){location.href='../index.html';return;}
 const {data:profile,error:pe}=await sb.from('profiles').select('role,is_blocked').eq('id',user.id).single();
 if(pe||!profile||profile.is_blocked||profile.role!=='admin'){location.href='calendar.html';return;}
 const $=id=>document.getElementById(id), esc=window.escapeHtml|| (v=>String(v??''));
 const dateISO=d=>{const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Almaty',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);const o=Object.fromEntries(p.map(x=>[x.type,x.value]));return `${o.year}-${o.month}-${o.day}`};
 const addDays=(iso,n)=>{const d=new Date(iso+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
 const fmt=iso=>{const [y,m,d]=iso.split('-');return `${d}.${m}.${y}`};
 let all=[],verified=new Set(),activeKind=null,settings={supply_types:[]};
 const {data:st}=await sb.from('app_settings').select('supply_types').eq('id',1).single();settings=st||settings;
 (settings.supply_types||[]).forEach(x=>{const o=document.createElement('option');o.value=String(x.id);o.textContent=x.name;$('supplyFilter').append(o)});
 const fetchForDate=async date=>{
  const {data,error}=await sb.from('bookings').select('id,profile_id,slot_date,slot_hour,order_number,order_type,supply_type,supply_types,comment,profiles!inner(company_name,inn)').eq('status','active').eq('slot_date',date).order('slot_hour');
  if(error)throw error;all=data||[];
  const {data:v,error:ve}=await sb.from('booking_verification').select('booking_id,verified').in('booking_id',all.map(x=>x.id).filter(Boolean));
  if(ve)throw ve;verified=new Set((v||[]).filter(x=>x.verified).map(x=>String(x.booking_id)));
 };
 const chooseDefault=async()=>{
  const tomorrow=addDays(dateISO(new Date()),1);
  const {data,error}=await sb.from('bookings').select('slot_date').eq('status','active').gte('slot_date',tomorrow).order('slot_date').limit(1);
  if(error)throw error;
  return data?.[0]?.slot_date||tomorrow;
 };
 const filtered=()=>all.filter(b=>{
  const p=Array.isArray(b.profiles)?b.profiles[0]||{}:b.profiles||{};
  const supplier=$('supplierFilter').value.trim().toLocaleLowerCase('ru'),doc=$('docFilter').value.trim().toLocaleLowerCase('ru');
  const supply=$('supplyFilter').value,order=$('orderFilter').value;
  const types=b.supply_types?.length?b.supply_types:[b.supply_type].filter(Boolean);
  return (!supplier||`${p.company_name||''} ${p.inn||''}`.toLocaleLowerCase('ru').includes(supplier))&&(!doc||String(b.order_number||'').toLocaleLowerCase('ru').includes(doc))&&(!supply||types.map(String).includes(supply))&&(!order||b.order_type===order);
 });
 const isReturn=b=>{const ts=b.supply_types?.length?b.supply_types:[b.supply_type].filter(Boolean);return ts.some(t=>String(t).toLowerCase()==='return'||String(settings.supply_types?.find(x=>String(x.id)===String(t))?.name||t).toLocaleLowerCase('ru').includes('возврат'))};
 const render=()=>{
  const rows=filtered();$('totalCount').textContent=rows.length;$('unverifiedCount').textContent=rows.filter(b=>!verified.has(String(b.id))).length;$('returnCount').textContent=rows.filter(isReturn).length;
  $('dateCaption').textContent=`Данные на ${fmt($('dateFilter').value)}`;
  if(activeKind)showList(activeKind);
 };
 const showList=kind=>{
  activeKind=kind;const rows=filtered().filter(b=>kind==='unverified'?!verified.has(String(b.id)):isReturn(b));
  $('listPanel').hidden=false;$('listTitle').textContent=kind==='unverified'?'Заявки без верификации':'Заявки с типом поставки «Возврат»';
  $('bookingList').innerHTML=rows.length?rows.map(b=>{
   const p=Array.isArray(b.profiles)?b.profiles[0]||{}:b.profiles||{},on=verified.has(String(b.id));
   const time=`${String(b.slot_hour).padStart(2,'0')}:00`;
   return `<div class="booking-row"><div><b>${time}</b><div class="muted">${fmt(b.slot_date)}</div></div><div><b>${esc(p.company_name||'Поставщик')}</b><div class="muted">ИНН: ${esc(p.inn||'—')}</div></div><div class="extra"><b>${esc(b.order_number||'Без номера')}</b><div class="muted">${esc((b.supply_types||[b.supply_type]).map(t=>settings.supply_types?.find(x=>String(x.id)===String(t))?.name||t).join(', '))}</div></div><div class="extra muted">${({order:'Заказ',upd:'УПД',etrn:'ЭТрН'}[b.order_type]||'')}</div><button class="verify-btn ${on?'on':'off'}" data-verify="${esc(b.id)}" title="${on?'Снять верификацию':'Отметить верифицированной'}" aria-label="Верификация">${on?`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="m9 15 2 2 4-4"/></svg>`:`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 11v4"/><path d="M12 18h.01"/></svg>`}</button></div>`;
  }).join(''):'<div class="empty">Заявок по выбранным фильтрам нет</div>';
 };
 const load=async date=>{try{$('bookingList').innerHTML='<div class="empty">Загрузка…</div>';await fetchForDate(date);render();if(activeKind)showList(activeKind)}catch(e){console.error(e);alert('Не удалось загрузить обзор: '+e.message)}};
 $('applyBtn').onclick=()=>{activeKind=null;$('listPanel').hidden=true;load($('dateFilter').value)};
 $('resetBtn').onclick=async()=>{$('supplierFilter').value='';$('docFilter').value='';$('supplyFilter').value='';$('orderFilter').value='';$('dateFilter').value=await chooseDefault();activeKind=null;$('listPanel').hidden=true;load($('dateFilter').value)};
 $('dateFilter').onchange=()=>{activeKind=null;$('listPanel').hidden=true;load($('dateFilter').value)};
 document.querySelectorAll('.metric[data-kind]').forEach(el=>el.onclick=()=>showList(el.dataset.kind));
 $('closeList').onclick=()=>{$('listPanel').hidden=true;activeKind=null};
 $('bookingList').addEventListener('click',async e=>{
  const btn=e.target.closest('[data-verify]');if(!btn)return;
  const id=btn.dataset.verify,was=verified.has(String(id));btn.disabled=true;
  try{
   if(was){const {error}=await sb.from('booking_verification').delete().eq('booking_id',id);if(error)throw error;verified.delete(String(id))}
   else{const {error}=await sb.from('booking_verification').upsert({booking_id:id,verified:true,verified_by:user.id,verified_at:new Date().toISOString()},{onConflict:'booking_id'});if(error)throw error;verified.add(String(id))}
   render();
  }catch(err){alert('Не удалось изменить признак верификации: '+err.message);btn.disabled=false}
 });
 $('exportBtn').onclick=()=>{
  const rows=filtered();if(!rows.length){alert('Нет заявок для выгрузки.');return}
  const q=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  const csv=[['№','Поставщик','ИНН','Дата','Время','Номер документа','Тип документа','Тип поставки','Верифицирована','Комментарий'].map(q).join(';')];
  rows.forEach((b,i)=>{const p=Array.isArray(b.profiles)?b.profiles[0]||{}:b.profiles||{};const types=b.supply_types?.length?b.supply_types:[b.supply_type].filter(Boolean);csv.push([i+1,p.company_name,p.inn,fmt(b.slot_date),`${String(b.slot_hour).padStart(2,'0')}:00`,b.order_number,({order:'Заказ',upd:'УПД',etrn:'ЭТрН'}[b.order_type]||b.order_type),types.map(t=>settings.supply_types?.find(x=>String(x.id)===String(t))?.name||t).join(', '),verified.has(String(b.id))?'Да':'Нет',b.comment].map(q).join(';'))});
  const blob=new Blob(['\ufeff'+csv.join('\r\n')],{type:'text/csv;charset=utf-8;'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`реестр-заявок-${$('dateFilter').value}.csv`;a.click();URL.revokeObjectURL(url);
 };
 $('logoutBtn').onclick=async e=>{e.preventDefault();await sb.auth.signOut();location.href='../index.html'};
 try{$('dateFilter').value=await chooseDefault();await load($('dateFilter').value)}catch(e){console.error(e);alert('Не удалось определить дату обзора: '+e.message)}
});