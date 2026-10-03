const STATES=["Andhra Pradesh","Arunachal Pradesh","Assam","Bihar","Chhattisgarh","Goa","Gujarat","Haryana","Himachal Pradesh","Jharkhand","Karnataka","Kerala","Madhya Pradesh","Maharashtra","Manipur","Meghalaya","Mizoram","Nagaland","Odisha","Punjab","Rajasthan","Sikkim","Tamil Nadu","Telangana","Tripura","Uttar Pradesh","Uttarakhand","West Bengal","Andaman and Nicobar Islands","Chandigarh","Dadra and Nagar Haveli and Daman and Diu","Delhi","Jammu and Kashmir","Ladakh","Lakshadweep","Puducherry"];
const $=s=>document.querySelector(s), form=$('#form'), touched=new Set();
STATES.forEach(s=>$('#state').add(new Option(s,s)));
const q=new URLSearchParams(location.search).get('campaign'); if(q)$('#campaign').value=q.slice(0,120);
const M=/^[6-9]\d{9}$/;
const rules={
  fullName:v=>v.trim().length<2&&'Enter your full name',
  email:v=>!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim())&&'Enter a valid email address',
  primaryMobile:v=>!M.test(v)&&'Enter a valid 10-digit Indian mobile number',
  backupMobile:(v,d)=>v&&(!M.test(v)?'Enter a valid 10-digit mobile number':v===d.primaryMobile&&'Backup number must be different from the primary number'),
  age:v=>v&&!(v>=13&&v<=100)&&'Enter an age between 13 and 100',
  campaign:v=>!v.trim()&&'Enter the giveaway or campaign name',
  contactMethod:v=>!v&&'Choose how we should contact you',
  verified:v=>!v&&'Please confirm your information is accurate',
  consent:v=>!v&&'Please accept to continue'};
const REQUIRED=['fullName','email','primaryMobile','campaign','contactMethod','verified','consent'];
const data=()=>{const d=Object.fromEntries(new FormData(form));d.verified=form.verified.checked;d.consent=form.consent.checked;return d};
const box=n=>$('#g-'+n)||form.elements[n]?.closest?.('.field');
function show(n,msg){const b=box(n);if(!b)return;b.classList.toggle('invalid',!!msg);const e=b.querySelector('.err');if(e)e.textContent=msg||''}
function check(n,d=data()){const m=rules[n]&&rules[n](d[n]||'',d);show(n,m||'');return !m}
function progress(){const d=data(),ok=REQUIRED.filter(n=>!rules[n](d[n]||'',d)).length;
  $('#progText').textContent=`${ok} of ${REQUIRED.length} required items complete`;$('#progBar').style.width=ok/REQUIRED.length*100+'%'}
['primaryMobile','backupMobile'].forEach(n=>form[n].addEventListener('input',e=>e.target.value=e.target.value.replace(/\D/g,'').slice(0,10)));
form.addEventListener('input',progress);
form.addEventListener('change',e=>{progress();if(rules[e.target.name])check(e.target.name)});
form.addEventListener('focusout',e=>{const n=e.target.name;if(rules[n]&&e.target.type!=='checkbox'&&e.target.type!=='radio'&&(e.target.value||touched.has(n)))check(n);touched.add(n)});
form.addEventListener('submit',async ev=>{
  ev.preventDefault();const d=data(),banner=$('#banner');banner.hidden=true;
  const bad=Object.keys(rules).filter(n=>!check(n,d));
  if(bad.length){box(bad[0]).scrollIntoView({behavior:'smooth',block:'center'});form.elements[bad[0]].focus?.({preventScroll:true});return}
  const btn=$('#submit');btn.disabled=true;btn.textContent='Submitting your details...';
  try{
    const r=await fetch('/api/giveaway/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});
    const j=await r.json().catch(()=>({}));
    if(r.ok&&j.submissionId){$('#sid').textContent=j.submissionId;$('#formView').hidden=true;$('#doneView').hidden=false;scrollTo({top:0,behavior:'smooth'});btn.disabled=false;btn.textContent='Claim My Giveaway Reward 🎁';return}
    if(j.errors)Object.entries(j.errors).forEach(([n,m])=>show(n,m));
    banner.textContent=j.error||'Please fix the highlighted fields and try again.';banner.hidden=false;
  }catch{banner.textContent='We couldn’t reach the server. Check your connection and try again.';banner.hidden=false}
  btn.disabled=false;btn.textContent='Claim My Giveaway Reward 🎁';
});
$('#done').onclick=()=>{form.reset();$('#country').value='India';touched.clear();progress();$('#doneView').hidden=true;$('#formView').hidden=false};
progress();
