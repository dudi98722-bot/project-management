/* BERRI — יצוא לאקסל (xlsx אמיתי, בלי ספריות חיצוניות) */
'use strict';

var _crcT=null;
function crc32(b){
  if(!_crcT){ _crcT=new Uint32Array(256);
    for(var i=0;i<256;i++){ var c=i; for(var k=0;k<8;k++) c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1); _crcT[i]=c>>>0; } }
  var c=0xFFFFFFFF;
  for(var j=0;j<b.length;j++) c=_crcT[(c^b[j])&0xFF]^(c>>>8);
  return (c^0xFFFFFFFF)>>>0;
}
function zipStore(files){
  function u16(v){ return [v&255,(v>>8)&255]; }
  function u32(v){ return [v&255,(v>>8)&255,(v>>16)&255,(v>>>24)&255]; }
  var parts=[], cd=[], off=0;
  files.forEach(function(f){
    var nm=new TextEncoder().encode(f.name), crc=crc32(f.data), len=f.data.length;
    var lh=[].concat([0x50,0x4B,0x03,0x04],u16(20),u16(0x0800),u16(0),u16(0),u16(0),
      u32(crc),u32(len),u32(len),u16(nm.length),u16(0));
    parts.push(new Uint8Array(lh),nm,f.data);
    cd.push({nm:nm,crc:crc,len:len,off:off});
    off+=lh.length+nm.length+len;
  });
  var cdStart=off, cdParts=[];
  cd.forEach(function(c){
    var h=[].concat([0x50,0x4B,0x01,0x02],u16(20),u16(20),u16(0x0800),u16(0),u16(0),u16(0),
      u32(c.crc),u32(c.len),u32(c.len),u16(c.nm.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(c.off));
    cdParts.push(new Uint8Array(h),c.nm);
    off+=h.length+c.nm.length;
  });
  var eocd=new Uint8Array([].concat([0x50,0x4B,0x05,0x06],u16(0),u16(0),
    u16(files.length),u16(files.length),u32(off-cdStart),u32(cdStart),u16(0)));
  return new Blob(parts.concat(cdParts,[eocd]),
    {type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
}

function xlEsc(s){
  return String(s==null?"":s).replace(/[&<>"']/g,function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c];
  }).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,"");   // תווי בקרה פוסלים את הקובץ
}
function colLetter(i){ var s=""; i++; while(i>0){ var m=(i-1)%26; s=String.fromCharCode(65+m)+s; i=(i-m-1)/26; } return s; }
function xlDate(iso){    // מספר סידורי של אקסל: ימים מאז 30/12/1899
  var p=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso||"")); if(!p) return null;
  return Math.round((Date.UTC(+p[1],+p[2]-1,+p[3])-Date.UTC(1899,11,30))/86400000);
}
/* סגנונות: 0 טקסט · 1 כותרת · 2 כסף · 3 תאריך · 4 אחוז · 5 סיכום-מספר · 6 סיכום-טקסט */
var XL_STYLES='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+
'<numFmts count="3"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/>'+
'<numFmt numFmtId="165" formatCode="#,##0.00"/><numFmt numFmtId="166" formatCode="0.##&quot;%&quot;"/></numFmts>'+
'<fonts count="3">'+
'<font><sz val="11"/><name val="Arial"/></font>'+
'<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>'+
'<font><b/><sz val="11"/><name val="Arial"/></font></fonts>'+
'<fills count="3"><fill><patternFill patternType="none"/></fill>'+
'<fill><patternFill patternType="gray125"/></fill>'+
'<fill><patternFill patternType="solid"><fgColor rgb="FF0F1642"/><bgColor indexed="64"/></patternFill></fill></fills>'+
'<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>'+
'<border><left/><right/><top style="thin"><color rgb="FF888888"/></top><bottom/><diagonal/></border></borders>'+
'<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'+
'<cellXfs count="7">'+
'<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'+
'<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'+
'<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'+
'<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'+
'<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'+
'<xf numFmtId="165" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>'+
'<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/></cellXfs>'+
'<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

function safeSheetName(s,used){
  var n=String(s||"גיליון").replace(/[\\\/\?\*\[\]:]/g," ").trim().slice(0,28)||"גיליון";
  var base=n, i=2; while(used[n]){ n=base.slice(0,26)+" "+(i++); }
  used[n]=1; return n;
}
/* sheets: [{name, rows:[[cell,…]], foot:[[cell,…]]}]
   cell: מחרוזת/מספר, או {v,t} כאשר t = s|n|money|pct|d  */
function xlsxBlob(sheets){
  var files=[], used={}, names=[];
  function put(nm,str){ files.push({name:nm,data:new TextEncoder().encode(str)}); }
  var XD='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

  sheets.forEach(function(sh,si){
    var name=safeSheetName(sh.name,used); names.push(name);
    var body=(sh.rows||[]).filter(function(r){ return r && r.length; });
    var foot=(sh.foot||[]);
    var nCols=0;
    body.concat(foot).forEach(function(r){ if(r.length>nCols) nCols=r.length; });
    if(!nCols){ nCols=1; body=[["אין נתונים"]]; }

    var widths=new Array(nCols).fill(10);
    body.concat(foot).forEach(function(r){
      for(var i=0;i<nCols;i++){
        var c=r[i]; if(c==null) continue;
        var v=(typeof c==="object")?c.v:c;
        var L=String(v==null?"":v).length+3;
        if(L>widths[i]) widths[i]=Math.min(L,46);
      }
    });

    function cellXml(ref,c,foot){
      if(c==null||c==="") return '<c r="'+ref+'"'+(foot?' s="6"':'')+'/>';
      var t=(typeof c==="object")?(c.t||"s"):((typeof c==="number")?"n":"s");
      var v=(typeof c==="object")?c.v:c;
      if(v===""||v==null) return '<c r="'+ref+'"'+(foot?' s="6"':'')+'/>';
      if(t==="d"){ var d=xlDate(v); if(d==null) return '<c r="'+ref+'" t="inlineStr"'+(foot?' s="6"':'')+'><is><t>'+xlEsc(v)+'</t></is></c>';
        return '<c r="'+ref+'" s="3"><v>'+d+'</v></c>'; }
      if(t==="n"||t==="money"||t==="pct"){
        var n=Number(v); if(!isFinite(n)) n=0;
        var s=foot?5:(t==="money"?2:(t==="pct"?4:0));
        return '<c r="'+ref+'" s="'+s+'"><v>'+n+'</v></c>';
      }
      return '<c r="'+ref+'" t="inlineStr"'+(foot?' s="6"':'')+'><is><t xml:space="preserve">'+xlEsc(v)+'</t></is></c>';
    }

    var xml=XD+'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+
      '<sheetViews><sheetView rightToLeft="1"'+(si===0?' tabSelected="1"':'')+' workbookViewId="0">'+
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'+
      '<sheetFormatPr defaultRowHeight="15"/><cols>';
    for(var i=0;i<nCols;i++) xml+='<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+widths[i]+'" customWidth="1"/>';
    xml+='</cols><sheetData>';
    var rn=0;
    body.forEach(function(r,ri){
      rn++;
      xml+='<row r="'+rn+'">';
      for(var i=0;i<nCols;i++){
        var c=r[i];
        if(ri===0){    // שורת כותרת
          var v=(c&&typeof c==="object")?c.v:c;
          xml+= (v==null||v==="") ? '<c r="'+colLetter(i)+rn+'" s="1"/>'
            : '<c r="'+colLetter(i)+rn+'" s="1" t="inlineStr"><is><t xml:space="preserve">'+xlEsc(v)+'</t></is></c>';
        } else xml+=cellXml(colLetter(i)+rn,c,false);
      }
      xml+='</row>';
    });
    foot.forEach(function(r){
      rn++;
      xml+='<row r="'+rn+'">';
      for(var i=0;i<nCols;i++) xml+=cellXml(colLetter(i)+rn,r[i],true);
      xml+='</row>';
    });
    xml+='</sheetData>';
    if(body.length>1) xml+='<autoFilter ref="A1:'+colLetter(nCols-1)+body.length+'"/>';
    xml+='</worksheet>';
    put("xl/worksheets/sheet"+(si+1)+".xml",xml);
  });

  put("[Content_Types].xml",XD+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
    '<Default Extension="xml" ContentType="application/xml"/>'+
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+
    names.map(function(_,i){ return '<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join("")+
    '</Types>');
  put("_rels/.rels",XD+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  put("xl/workbook.xml",XD+'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '+
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+
    names.map(function(n,i){ return '<sheet name="'+xlEsc(n)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>'; }).join("")+
    '</sheets></workbook>');
  put("xl/_rels/workbook.xml.rels",XD+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
    names.map(function(_,i){ return '<Relationship Id="rId'+(i+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>'; }).join("")+
    '<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  put("xl/styles.xml",XL_STYLES);
  return zipStore(files);
}
/* שער מרכזי להורדות — רק משתמש מחובר מוריד קבצים. */
function canDownload(){ return !!S.user; }
function downloadBlob(blob,filename){
  if(!canDownload()){ toast("יש להתחבר כדי להוריד קבצים","err"); return; }
  var url=URL.createObjectURL(blob), a=document.createElement("a");
  a.href=url; a.download=filename; a.style.display="none";
  document.body.appendChild(a); a.click();
  setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); },2000);
}
function stamp(){ var d=new Date(); function p(x){return ("0"+x).slice(-2);}
  return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate()); }
function saveXlsx(sheets,filename){
  try{
    downloadBlob(xlsxBlob(sheets),String(filename).replace(/[\\\/:*?"<>|]/g,"-")+" "+stamp()+".xlsx");
    toast("הקובץ ירד — ניתן לפתוח באקסל","ok");
  }catch(err){ toast("הייצוא נכשל: "+err.message,"err"); }
}

