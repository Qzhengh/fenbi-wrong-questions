#!/usr/bin/env node
/*
 粉笔错题集 - 第2步：读 errors.json 生成 Word
 用法：  node build_docx.js
 输入：  errors.json（parse.py 产出）、images/（下载好的图片）
 输出：  错题集.docx
 说明：  纯排版，不联网。图片有本地文件则嵌入，否则显示占位框。
*/
const fs=require('fs');
const path=require('path');
const {Document,Packer,Paragraph,TextRun,ImageRun,AlignmentType,HeadingLevel,
       BorderStyle,PageNumber,Footer}=require('docx');

const data=JSON.parse(fs.readFileSync('errors.json','utf8'));
const IMG_DIR='images';

// 收集缺失的图，用于最后导出"缺图清单"，方便用户手动补
const crypto=require('crypto');
const missingImgs=[];   // {file, url, kind}
function fnameFromUrl(url){
  // 与 parse.py 一致：md5(url)[:12]+'.png'
  return crypto.createHash('md5').update(url).digest('hex').slice(0,12)+'.png';
}
function recordMissing(p){
  let url=p.src||'';
  if(url.startsWith('//')) url='https:'+url;
  else if(url.startsWith('/')) url='https://fb.fenbike.cn'+url;
  // local 可能为 null（下载彻底失败）→ 用url重新算出应有的文件名
  const file=p.local || fnameFromUrl(url);
  if(!missingImgs.find(m=>m.file===file)){
    missingImgs.push({file, url, kind:isTexPart(p)?'公式':'图片'});
  }
}

// ---- 读取本地图片真实尺寸（PNG/JPG）----
function realSize(file){
  try{
    const b=fs.readFileSync(file);
    if(b.length>24 && b[0]===0x89 && b[1]===0x50){
      return {w:b.readUInt32BE(16), h:b.readUInt32BE(20)};
    }
    // JPEG: 扫描 SOF 段
    if(b[0]===0xFF && b[1]===0xD8){
      let i=2;
      while(i<b.length){
        if(b[i]!==0xFF){i++;continue;}
        const marker=b[i+1];
        if(marker>=0xC0 && marker<=0xCF && marker!==0xC4 && marker!==0xC8 && marker!==0xCC){
          return {h:b.readUInt16BE(i+5), w:b.readUInt16BE(i+7)};
        }
        i += 2 + b.readUInt16BE(i+2);
      }
    }
  }catch(e){}
  return null;
}

// 判断本地图片是否"可用"：文件存在 且 是合法PNG/JPG（不只是存在）
// 加密图/坏图虽然文件存在，但开头不是合法图片签名 → 判为不可用
function isUsableImage(fpath){
  try{
    if(!fpath || !fs.existsSync(fpath)) return false;
    const b=fs.readFileSync(fpath);
    if(b.length<8) return false;
    const isPNG = b[0]===0x89 && b[1]===0x50 && b[2]===0x4E && b[3]===0x47;
    const isJPG = b[0]===0xFF && b[1]===0xD8;
    return isPNG || isJPG;
  }catch(e){ return false; }
}

// ---- 方案甲尺寸策略 ----
// 普通图：最大宽 420px（约页面可用宽 70%），按真实比例缩放，超宽才缩
// 公式图：按"高度"缩放到与正文协调（正文约22半角=11pt≈15px高）。
//        行内小公式高度目标 ~20px；整行大公式（很宽）按最大宽限制但保持比例。
const MAX_W_PX=420;
const FORMULA_TARGET_H=26;     // 公式目标高度(px)
const FORMULA_MAX_W=380;       // 公式最大宽(px)，超宽的整行公式用这个兜底

// 判断片段是否公式图（优先用 parse 存的 is_tex 标记，兼容旧数据用网址）
function isTexPart(p){
  if(p && typeof p.is_tex==='boolean') return p.is_tex;
  return /formula|latex/.test((p&&p.src)||'');
}
function isFormula(src){return /formula|latex/.test(src||'');}

function calcDim(p,realW,realH){
  const w=realW||p.w||300, h=realH||p.h||200;
  if(isTexPart(p)){
    // 先按目标高度缩放
    let r=FORMULA_TARGET_H/h;
    let nw=w*r, nh=h*r;
    // 若缩放后还是太宽（长公式），改按最大宽限制
    if(nw>FORMULA_MAX_W){ r=FORMULA_MAX_W/w; nw=w*r; nh=h*r; }
    return {width:Math.max(1,Math.round(nw)), height:Math.max(1,Math.round(nh))};
  }else{
    if(w<=MAX_W_PX) return {width:w,height:h};
    const r=MAX_W_PX/w;
    return {width:Math.round(w*r), height:Math.round(h*r)};
  }
}

// 生成一个图片的 ImageRun（行内用）；图缺失时返回占位 TextRun
function imgRun(p){
  const fpath=p.local?path.join(IMG_DIR,p.local):null;
  if(isUsableImage(fpath)){
    const rs=realSize(fpath);
    const dim=calcDim(p, rs&&rs.w, rs&&rs.h);
    try{
      return new ImageRun({type:'png',data:fs.readFileSync(fpath),
        transformation:{width:dim.width,height:dim.height}});
    }catch(e){}
  }
  const label=isTexPart(p)?'公式':'图';
  recordMissing(p);
  return new TextRun({text:`［${label}缺失 ${p.w||'?'}×${p.h||'?'} 需手动补］`,
                      size:18,color:"D08000",italics:true});
}

// 普通大图单独成段（居中）
function imgParagraph(p){
  const fpath=p.local?path.join(IMG_DIR,p.local):null;
  const exists=isUsableImage(fpath);
  if(exists){
    const rs=realSize(fpath);
    const dim=calcDim(p, rs&&rs.w, rs&&rs.h);
    try{
      const run=new ImageRun({type:'png',data:fs.readFileSync(fpath),
        transformation:{width:dim.width,height:dim.height}});
      return new Paragraph({spacing:{before:60,after:60},
        alignment:AlignmentType.CENTER, children:[run]});
    }catch(e){}
  }
  recordMissing(p);
  return new Paragraph({spacing:{before:40,after:40},alignment:AlignmentType.CENTER,
    border:{top:{style:BorderStyle.DASHED,size:4,color:"D08000",space:6},
            left:{style:BorderStyle.DASHED,size:4,color:"D08000",space:6},
            bottom:{style:BorderStyle.DASHED,size:4,color:"D08000",space:6},
            right:{style:BorderStyle.DASHED,size:4,color:"D08000",space:6}},
    children:[new TextRun({text:`［图片缺失　原图 ${p.w||'?'}×${p.h||'?'}px　需手动补］`,
                           size:18,color:"D08000",italics:true})]});
}

/*
 renderParts —— 方案B 全行内混排：
 - 把连续的「文字 + 公式图」全部放进同一个段落的 children 行内排列，
   公式作行内图片、文字作行内文字，由 Word 按页宽自动折行（最还原阅读）。
 - 只有「普通大图」(图表/图形题，非公式) 才打断当前段、单独居中成段。
*/
function renderParts(parts,{indent=0, indentFirstLine=false}={}){
  const out=[];
  let runs=[];          // 当前正在攒的行内 run
  function flush(){
    if(runs.length){
      const para={spacing:{after:80,line:360}, children:runs};
      if(indent && indentFirstLine) para.indent={left:indent, firstLine:480};
      else if(indent) para.indent={left:indent};
      out.push(new Paragraph(para));
      runs=[];
    }
  }
  for(const p of parts){
    if(p.type==='img' && !isTexPart(p)){
      flush();
      out.push(imgParagraph(p));
    }else if(p.type==='img' && isTexPart(p)){
      runs.push(imgRun(p));            // 公式 → 行内图片
    }else if(p.type==='text'){
      if(p.nl) flush();                // 另起段 → 断开上一段
      runs.push(new TextRun({text:p.val,size:22}));
    }
  }
  flush();
  return out;
}

function isPlaceholderOptions(options){
  if(!options.length) return false;
  return options.every(opt=>opt.length===1 && opt[0].type==='text'
    && /^[A-Z]$/.test(opt[0].val.trim()));
}

const children=[];
const today=new Date().toISOString().slice(0,10);

// 标题
children.push(new Paragraph({heading:HeadingLevel.HEADING_1,alignment:AlignmentType.CENTER,
  children:[new TextRun({text:data.title,size:32,bold:true})]}));
children.push(new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:120},
  children:[new TextRun({text:`错题集（间隔重做用）　收集日期：${today}　共 ${data.items.length} 题`,
                         size:20,color:"666666"})]}));
children.push(new Paragraph({spacing:{after:120},
  border:{bottom:{style:BorderStyle.SINGLE,size:6,color:"2E75B6",space:1}},children:[new TextRun("")]}));

let qno=0,curSection='';
const seenMaterial={};   // 材料指纹 -> 首次出现的题(qno, gno)
function matFingerprint(materials){
  const sig=[];
  for(const mat of materials) for(const p of mat)
    sig.push(p.type==='text'?p.val:'IMG:'+(p.src||''));
  return sig.join('|');
}
for(const it of data.items){
  if(it.section!==curSection){
    curSection=it.section;
    children.push(new Paragraph({heading:HeadingLevel.HEADING_2,spacing:{before:200,after:120},
      children:[new TextRun({text:`【${it.section}】`,size:26,bold:true,color:"2E75B6"})]}));
  }
  qno++;
  children.push(new Paragraph({spacing:{before:160,after:60},
    children:[new TextRun({text:`${qno}. `,size:24,bold:true}),
              new TextRun({text:`（${it.section}　原卷第 ${it.gno} 题）`,size:18,color:"888888"})]}));
  if(it.materials && it.materials.length){
    const fp=matFingerprint(it.materials);
    if(seenMaterial[fp]){
      // 重复材料：只提示去哪看，不再重复显示
      const ref=seenMaterial[fp];
      children.push(new Paragraph({spacing:{before:40,after:40},
        children:[new TextRun({text:`【材料】见上方第 ${ref.qno} 题（原卷第 ${ref.gno} 题）的材料`,
                               size:20,italics:true,color:"CC7000"})]}));
    }else{
      seenMaterial[fp]={qno,gno:it.gno};
      children.push(new Paragraph({spacing:{before:40,after:40},
        children:[new TextRun({text:"【材料】",size:20,bold:true,color:"CC7000"})]}));
      for(const mat of it.materials) renderParts(mat,{indent:240,indentFirstLine:true}).forEach(p=>children.push(p));
    }
    children.push(new Paragraph({spacing:{after:40},
      children:[new TextRun({text:"【问题】",size:20,bold:true,color:"CC7000"})]}));
  }
  renderParts(it.stem).forEach(p=>children.push(p));
  if(isPlaceholderOptions(it.options)){
    children.push(new Paragraph({spacing:{after:40},indent:{left:240},
      children:[new TextRun({text:"（选项见上图）",size:20,italics:true,color:"888888"})]}));
  }else{
    const NUM2LETTER=['A','B','C','D','E','F'];
    it.options.forEach((opt,i)=>{
      const label=NUM2LETTER[i]||String.fromCharCode(65+i);
      const first=opt[0];
      if(opt.length===1 && first.type==='text'){
        children.push(new Paragraph({spacing:{after:40},indent:{left:240},
          children:[new TextRun({text:`${label}. `,size:22,bold:true}),
                    new TextRun({text:first.val,size:22})]}));
      }else{
        children.push(new Paragraph({spacing:{after:20},indent:{left:240},
          children:[new TextRun({text:`${label}.`,size:22,bold:true})]}));
        renderParts(opt,{indent:480}).forEach(p=>children.push(p));
      }
    });
  }
}

// 答案页
children.push(new Paragraph({children:[],pageBreakBefore:true}));
children.push(new Paragraph({heading:HeadingLevel.HEADING_1,alignment:AlignmentType.CENTER,
  children:[new TextRun({text:"参考答案与解析",size:30,bold:true})]}));
children.push(new Paragraph({spacing:{after:120},
  border:{bottom:{style:BorderStyle.SINGLE,size:6,color:"2E75B6",space:1}},children:[new TextRun("")]}));
qno=0;
for(const it of data.items){
  qno++;
  children.push(new Paragraph({spacing:{before:140,after:40},
    children:[new TextRun({text:`${qno}. `,size:24,bold:true}),
              new TextRun({text:`正确答案：${it.answer}`,size:24,bold:true,color:"2E7D32"}),
              new TextRun({text:`　（原卷第 ${it.gno} 题）`,size:18,color:"888888"})]}));
  renderParts(it.solution).forEach(p=>children.push(p));
}

const doc=new Document({
  styles:{default:{document:{run:{font:"Arial",size:22}}},
    paragraphStyles:[
      {id:"Heading1",name:"Heading 1",basedOn:"Normal",next:"Normal",quickFormat:true,
       run:{size:32,bold:true,font:"Arial"},paragraph:{spacing:{before:240,after:240},outlineLevel:0}},
      {id:"Heading2",name:"Heading 2",basedOn:"Normal",next:"Normal",quickFormat:true,
       run:{size:26,bold:true,font:"Arial"},paragraph:{spacing:{before:180,after:120},outlineLevel:1}},
    ]},
  sections:[{
    properties:{page:{size:{width:12240,height:15840},
      margin:{top:1440,right:1440,bottom:1440,left:1440}}},
    footers:{default:new Footer({children:[new Paragraph({alignment:AlignmentType.CENTER,
      children:[new TextRun({text:"第 ",size:18,color:"888888"}),
                new TextRun({children:[PageNumber.CURRENT],size:18,color:"888888"}),
                new TextRun({text:" 页",size:18,color:"888888"})]})]})},
    children}]
});

Packer.toBuffer(doc).then(buf=>{fs.writeFileSync('错题集.docx',buf);
  console.log('✅ 生成 错题集.docx');
  if(missingImgs.length>0){
    // 导出缺图清单，方便手动补
    let txt='# 缺图清单（这些图需要手动补，多为粉笔加密图）\n';
    txt+=`# 共 ${missingImgs.length} 张。补法：在Chrome打开下面的"网址"，右键图片→图像另存为，\n`;
    txt+='# 文件名改成对应的"文件名"（一字不差），存进 images 文件夹，覆盖原文件。补完重跑 node build_docx.js。\n\n';
    missingImgs.forEach((m,i)=>{
      txt+=`${i+1}. 【${m.kind}】\n   文件名：${m.file}\n   网址：${m.url}\n\n`;
    });
    fs.writeFileSync('缺图清单.txt',txt);
    console.log(`⚠️ 有 ${missingImgs.length} 张图缺失，已生成「缺图清单.txt」，按里面说明手动补。`);
  }else{
    console.log('✅ 所有图片完整，无需手动补。');
  }
});
