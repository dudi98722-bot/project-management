/* נתוני הדגמה דטרמיניסטיים למשפחה ישראלית — 15 חודשים (08/2025 עד 08/10/2026).
   makeDB(kind) מחזיר {tx, cats}. kind: 'full' | 'empty' | 'one' | 'income' | 'xss' | 'sparse' */
(function(root){
  const CATS = [
    ['מזון וסופר','expense','#16a34a','🛒'], ['אוכל בחוץ','expense','#65a30d','🍽️'],
    ['דיור — משכנתא/שכ"ד','expense','#0891b2','🏠'], ['ארנונה וועד בית','expense','#0e7490','🏛️'],
    ['חשמל, מים וגז','expense','#f59e0b','💡'], ['תקשורת','expense','#8b5cf6','📱'],
    ['רכב ותחבורה','expense','#dc2626','🚗'], ['חינוך','expense','#2563eb','🎓'],
    ['בריאות','expense','#db2777','⚕️'], ['ביטוחים','expense','#475569','🛡️'],
    ['ביגוד והנעלה','expense','#c026d3','👕'], ['בית ותחזוקה','expense','#78716c','🔧'],
    ['צדקה ומעשרות','expense','#ca8a04','🤲'], ['אירועים ומתנות','expense','#e11d48','🎁'],
    ['חגים','expense','#7c3aed','🕎'], ['פנאי','expense','#0ea5e9','🎈'],
    ['הלוואות והחזרים','expense','#334155','🏦'], ['שונות','expense','#94a3b8','🏷️'],
    ['משכורת','income','#059669','💼'], ['קצבאות','income','#0d9488','🧾'],
    ['הכנסות נוספות','income','#10b981','➕'], ['מתנות שהתקבלו','income','#84cc16','🎀']
  ];
  function rng(seed){ let s=seed>>>0; return ()=>{ s=(s*1664525+1013904223)>>>0; return s/4294967296; }; }
  const pad=n=>String(n).padStart(2,'0');
  function daysIn(y,m){ return new Date(y,m,0).getDate(); }
  function dow(y,m,d){ return new Date(y,m-1,d).getDay(); } // 0=ראשון

  function makeCats(){
    return CATS.map((c,i)=>({id:'c-17000000000'+pad(i)+'-'+i, name:c[0], kind:c[1], color:c[2], icon:c[3], ord:String(i), deleted:''}));
  }

  function makeFull(opts){
    opts=opts||{};
    const R=rng(opts.seed||7);
    const tx=[]; let n=0;
    const TODAY = opts.today || '2026-10-08';
    const add=(date,desc,amount,kind,category,payment,src,status)=>{
      if(date>TODAY) return;
      n++;
      tx.push({id:'t-1700000000000-'+n, date, desc, amount:String(Math.round(amount*100)/100), kind,
        category, status:status||'ok', payment:payment||'', note:'', src:src||'', srcFile:'', srcRow:'',
        srcRaw:'', importedAt:'', importedBy:'', classBy:'', enteredBy:'', deleted:''});
    };
    const months=[]; { let y=2025,m=8; while(y<2026||(y===2026&&m<=10)){ months.push([y,m]); m++; if(m>12){m=1;y++;} } }
    const VISA='ויזה כאל', MAX='מקס', OSH='עו"ש', CASH='מזומן';
    const SRC_V='ויזה כאל — אשראי', SRC_M='מקס — אשראי', SRC_B='בנק לאומי — עו"ש';
    months.forEach(([y,m],mi)=>{
      const D=daysIn(y,m), ym=y+'-'+pad(m);
      const d=day=>ym+'-'+pad(Math.min(day,D));
      // הכנסות
      add(d(9),'משכורת — חברת הייטק בע"מ', 14200+Math.round(R()*300), 'income','משכורת',OSH,SRC_B);
      add(d(10),'משכורת — משרד החינוך', 8650+(mi>9?400:0), 'income','משכורת',OSH,SRC_B);
      add(d(20),'ביטוח לאומי — קצבת ילדים', 642, 'income','קצבאות',OSH,SRC_B);
      if(R()<.35) add(d(3+Math.floor(R()*20)),'העברה מפרויקט צד', 800+Math.round(R()*2200),'income','הכנסות נוספות',OSH,SRC_B);
      // קבועות
      add(d(10),'משכנתא — בנק מזרחי טפחות', 4820, 'expense','דיור — משכנתא/שכ"ד',OSH,SRC_B);
      if(m%2===1) add(d(15),'עיריית ירושלים — ארנונה', 1380, 'expense','ארנונה וועד בית',OSH,SRC_B);
      add(d(5),'ועד בית', 180, 'expense','ארנונה וועד בית',CASH,'');
      if(m%2===0) add(d(18),'חברת החשמל', 520+Math.round(R()*240)+(m===8||m===1?260:0), 'expense','חשמל, מים וגז',OSH,SRC_B);
      if(m%2===1) add(d(22),'הגיחון — מים', 210+Math.round(R()*90), 'expense','חשמל, מים וגז',OSH,SRC_B);
      add(d(2),'פרטנר תקשורת', 89.9, 'expense','תקשורת',VISA,SRC_V);
      add(d(2),'בזק — אינטרנט', 119, 'expense','תקשורת',VISA,SRC_V);
      add(d(4),'NETFLIX.COM', 54.9, 'expense','פנאי',VISA,SRC_V);
      add(d(7),'SPOTIFY', 19.9, 'expense','פנאי',MAX,SRC_M);
      if(mi>=4) add(d(11),'מכון כושר הולמס פלייס', 249, 'expense','פנאי',MAX,SRC_M);
      add(d(1),'גן ילדים — עמותת אור', 1850, 'expense','חינוך',OSH,SRC_B);
      if(!(m===7||m===8)) add(d(1),'תלמוד תורה — שכר לימוד', 950, 'expense','חינוך',OSH,SRC_B);
      add(d(12),'הראל ביטוח — רכב', 312, 'expense','ביטוחים',VISA,SRC_V);
      add(d(12),'מגדל — ביטוח חיים', 186.4, 'expense','ביטוחים',OSH,SRC_B);
      add(d(25),'מעשרות — העברה לקופה', 2100, 'expense','צדקה ומעשרות',OSH,SRC_B);
      add(d(14),'הלוואה — החזר חודשי', 1250, 'expense','הלוואות והחזרים',OSH,SRC_B);
      // סופר: 3-5 בשבוע, שישי גדול
      for(let day=1; day<=D; day++){
        const w=dow(y,m,day);
        if(w===6) continue; // שבת
        const p = w===5 ? .9 : w===4 ? .55 : .3;
        if(R()<p){
          const big = w===5 || w===4;
          const store = big ? (R()<.6?'שופרסל דיל':'רמי לוי שיווק השקמה') : (R()<.5?'מכולת השכונה':'יוחננוף');
          add(d(day), store, (big?320:60)+Math.round(R()*(big?380:120)), 'expense','מזון וסופר', R()<.5?VISA:MAX, R()<.5?SRC_V:SRC_M);
        }
        if(R()<.08) add(d(day), R()<.5?'פיצה האט':'שווארמה הקוסם', 85+Math.round(R()*140), 'expense','אוכל בחוץ',MAX,SRC_M);
        if(R()<.12) add(d(day), R()<.5?'פז — תחנת דלק':'סונול', 180+Math.round(R()*160), 'expense','רכב ותחבורה',VISA,SRC_V);
        if(R()<.05) add(d(day), 'רב-קו טעינה', 50+Math.round(R()*50), 'expense','רכב ותחבורה',MAX,SRC_M);
        if(R()<.03) add(d(day), 'סופר-פארם', 60+Math.round(R()*180), 'expense','בריאות',MAX,SRC_M);
      }
      if(R()<.5) add(d(8+Math.floor(R()*15)),'קופת חולים — השתתפות עצמית', 35+Math.round(R()*80),'expense','בריאות',VISA,SRC_V);
      if(R()<.45) add(d(5+Math.floor(R()*20)), R()<.5?'קסטרו':'H&M', 150+Math.round(R()*450),'expense','ביגוד והנעלה',MAX,SRC_M);
      if(R()<.35) add(d(5+Math.floor(R()*20)), 'ACE — כלי בית', 90+Math.round(R()*400),'expense','בית ותחזוקה',VISA,SRC_V);
      if(R()<.4) add(d(5+Math.floor(R()*20)), 'מתנה לחתונה', 400+Math.round(R()*500),'expense','אירועים ומתנות',CASH,'');
      if(R()<.5) add(d(5+Math.floor(R()*20)), 'שונות — קיוסק', 20+Math.round(R()*70),'expense','שונות',CASH,'');
      if(R()<.3) add(d(10+Math.floor(R()*15)), 'צדקה — ארגון חסד', 100+Math.round(R()*300),'expense','צדקה ומעשרות',VISA,SRC_V);
      // חגים: ספטמבר-אוקטובר, ואביב
      if(m===9||m===10){ add(d(12),'שוק מחנה יהודה — קניות לחג', 1150+Math.round(R()*500),'expense','חגים',CASH,'');
                          add(d(16),'ארבעת המינים', 380,'expense','חגים',VISA,SRC_V); }
      if(m===4){ add(d(6),'קניות לפסח — שופרסל', 2300,'expense','חגים',VISA,SRC_V);
                 add(d(8),'מצות שמורות', 420,'expense','חגים',CASH,''); }
      // חריגות
      if(ym==='2025-12') add(d(18),'איקאה — ספה לסלון', 4290,'expense','בית ותחזוקה',VISA,SRC_V);
      if(ym==='2026-03') add(d(9),'מוסך — טיפול 60 אלף + בלמים', 3150,'expense','רכב ותחבורה',VISA,SRC_V);
      if(ym==='2026-06') add(d(21),'טיסה — אל על', 6840,'expense','פנאי',MAX,SRC_M);
      // סטטוסים שאינם נספרים
      if(R()<.6) add(d(3+Math.floor(R()*20)),'חיוב כרטיס אשראי ויזה', 5400+Math.round(R()*2000),'expense','',OSH,SRC_B,'irrelevant');
    });
    // החודש הנוכחי: כמה ממתינות לסיווג + לבדיקה
    add('2026-10-06','ALIEXPRESS', 143.2,'expense','',MAX,SRC_M,'pending');
    add('2026-10-07','העברה בביט', 250,'expense','',OSH,SRC_B,'pending');
    add('2026-10-05','אמזון — הזמנה', 389,'expense','שונות',VISA,SRC_V,'review');
    // זיכוי / החזר (הכנסה מקטגוריית הוצאה)
    add('2026-09-14','זיכוי — קסטרו', 179,'income','ביגוד והנעלה',MAX,SRC_M);
    // שורה מחוקה
    tx.push({id:'t-1700000000000-99999', date:'2026-10-03', desc:'שורה מחוקה', amount:'999', kind:'expense', category:'שונות', status:'ok', payment:VISA, src:SRC_V, deleted:'1'});
    return tx;
  }

  function makeDB(kind, opts){
    const cats=makeCats();
    if(kind==='empty') return {tx:[], cats};
    if(kind==='one') return {tx:makeFull(opts).filter(t=>t.date.slice(0,7)==='2026-10'), cats};
    if(kind==='sparse') return {tx:makeFull(opts).filter((t,i)=>i%9===0), cats};
    if(kind==='income') return {tx:makeFull(opts).filter(t=>t.kind==='income'), cats};
    if(kind==='xss'){
      const P='<img src=x onerror=alert(1)>', Q='"><svg/onload=alert(2)>', S="';alert(3)//";
      const tx=makeFull(opts).slice(0,400).map((t,i)=>Object.assign({},t,{
        desc: i%3===0 ? P+t.desc : i%3===1 ? Q : S+t.desc,
        category: i%5===0 ? Q : t.category,
        payment: i%4===0 ? P : t.payment,
        src: i%6===0 ? S+'<b>' : t.src,
        note: P
      }));
      const xc=cats.concat([{id:'c-1700000000099-1', name:Q, kind:'expense', color:'red;background:url(x)', icon:P, ord:'99', deleted:''}]);
      return {tx, cats:xc};
    }
    return {tx:makeFull(opts), cats};
  }
  root.HBDATA={makeDB, CATS};
})(typeof window!=='undefined'?window:globalThis);
