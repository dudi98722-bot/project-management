/* עזרים מתוך home-budget/index.html — העתק מדויק, לבדיקות ולתצוגה מקדימה בלבד.
   בקוד האמיתי הם כבר קיימים; קובצי הדוחות לא מגדירים אותם מחדש. */
var $ = id => document.getElementById(id);
var esc = s => String(s==null?'':s).replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
var fmt = n => (Math.round(Number(n||0)*100)/100).toLocaleString('he-IL',
                  {minimumFractionDigits:0, maximumFractionDigits:0});
var fmt2 = n => (Math.round(Number(n||0)*100)/100).toLocaleString('he-IL',
                  {minimumFractionDigits:2, maximumFractionDigits:2});
var normDesc = s => String(s||'').replace(/[־–—]+/g,'-').replace(/\s+/g,' ').trim();
var monthOf = d => String(d||'').slice(0,7);
function num(v){
  if(typeof v==='number') return isFinite(v)?v:0;
  let s=String(v==null?'':v)
    .replace(/[​-‏‪-‮⁦-⁩﻿]/g,'')
    .replace(/[₪,\s ]/g,'')
    .replace(/[־–—−]/g,'-')
    .trim();
  if(!s) return 0;
  let neg=false;
  if(/^\(.*\)$/.test(s)){ neg=true; s=s.slice(1,-1); }
  if(/-\s*$/.test(s)){ neg=true; s=s.replace(/-\s*$/,''); }
  if(/^-/.test(s)){ neg=true; s=s.slice(1); }
  const n=parseFloat(s);
  if(!isFinite(n)) return 0;
  return neg ? -Math.abs(n) : Math.abs(n);
}
function heMonth(ym){
  if(!ym) return '';
  const names=['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
  const [y,m]=ym.split('-');
  return names[Number(m)-1]+' '+y;
}
function addMonths(ym, k){
  let [y,m]=ym.split('-').map(Number);
  m+=k; y+=Math.floor((m-1)/12); m=((m-1)%12+12)%12+1;
  return y+'-'+String(m).padStart(2,'0');
}
function thisMonth(){
  const d=new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
}
var live = () => DB.tx.filter(t=>!t.deleted);
var counted = () => live().filter(t=>t.status==='ok'||t.status==='review');
var catByName = n => DB.cats.find(c=>c.name===n && !c.deleted);
function catColor(n){ const c=catByName(n); const v=c&&c.color;
  return /^#[0-9a-fA-F]{6}$/.test(v||'') ? v : '#94a3b8'; }
function catIcon(n){ const c=catByName(n); return esc((c?c.icon:'🏷️')||'🏷️').slice(0,12); }
function kpi(lbl,val,sub,cls){
  return '<div class="kpi"><div class="lbl">'+esc(lbl)+'</div>'+
         '<div class="val '+(cls||'')+'">'+val+'</div>'+
         (sub?'<div class="sub">'+esc(sub)+'</div>':'')+'</div>';
}
var ACTIONS={};
function act(name, id){ return ' data-act="'+name+'" data-id="'+esc(id)+'"'; }
function toast(msg){ try{ console.log('toast:', msg); }catch(e){} }
