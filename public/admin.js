const $=s=>document.querySelector(s);let W=[],ST=[];
const el=(t,txt,p)=>{const e=document.createElement(t);if(txt!=null)e.textContent=txt;p&&p.append(e);return e};
async function load(){const r=await fetch('/api/admin/winners');if(!r.ok)return location.reload();({winners:W,statuses:ST}=await r.json());
  if($('#filter').length===1)ST.forEach(s=>$('#filter').add(new Option(s,s)));render()}
function render(){
  const q=$('#search').value.toLowerCase(),f=$('#filter').value,n=s=>W.filter(w=>w.Status===s).length;
  $('#stats').replaceChildren(...[['Total Winners',W.length],['Pending Verification',n('Pending Verification')],['Verified',n('Verified')],['Contacted',n('Contacted')],['Completed',n('Completed')]].map(([l,v])=>{const d=el('div');d.className='stat';el('b',v,d);el('span',l,d);return d}));
  const list=W.filter(w=>(!f||w.Status===f)&&(!q||[w['Full Name'],w.Email,w['Primary Mobile'],w['Giveaway Name'],w['Submission ID']].join(' ').toLowerCase().includes(q)));
  $('#rows').replaceChildren(...list.map(w=>{const tr=el('tr');
    [w['Full Name'],w.Email,w['Primary Mobile'],w['Giveaway Name']].forEach(v=>el('td',v,tr));
    const sel=el('select',null,el('td',null,tr));ST.forEach(s=>sel.add(new Option(s,s)));sel.value=w.Status;
    sel.onchange=async()=>{const r=await fetch(`/api/admin/winners/${w['Submission ID']}/status`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:sel.value})});if(r.ok){w.Status=sel.value;render()}else{alert('Could not update status');sel.value=w.Status}};
    el('td',w.Timestamp,tr);const b=el('button','View',el('td',null,tr));b.onclick=()=>view(w);return tr}));
  if(!list.length){const tr=el('tr'),td=el('td','No winners found.',tr);td.colSpan=7;$('#rows').append(tr)}}
function view(w){$('#dTitle').textContent=w['Submission ID'];$('#dBody').replaceChildren(...Object.entries(w).flatMap(([k,v])=>v===''?[]:[el('dt',k),el('dd',v)]));$('#dlg').showModal()}
$('#dClose').onclick=()=>$('#dlg').close();$('#search').oninput=render;$('#filter').onchange=render;load();
