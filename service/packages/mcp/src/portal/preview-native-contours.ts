import { storedChecksum } from '@sfp/ir';
import type { Page } from 'playwright';

import {
  PortalNativeContourActualSchema,
  type PortalNativeContourActual,
} from '../../../shared/src/portal-native-contours.js';

/** Runs in an isolated Chrome world. The application cannot replace these DOM/CSS prototypes. */
const observe = String.raw`(input) => {
  const invalid=()=>{throw Error('PORTAL_CONSUMPTION_NATIVE_CONTOUR_MISMATCH');};
  const targets=document.querySelectorAll(input.selector),roots=document.querySelectorAll('[data-sfp-root='+JSON.stringify(input.rootNodeId)+']');
  if(targets.length!==1||roots.length!==1||!roots[0].contains(targets[0]))invalid();
  const target=targets[0],root=roots[0];
  if((target.getAttribute('data-sfp-node')??target.getAttribute('data-sfp-root'))!==input.nodeId)invalid();
  const svgs=target instanceof SVGSVGElement?[target]:Array.from(target.querySelectorAll('svg'));
  if(svgs.length!==1||!(svgs[0] instanceof SVGSVGElement))invalid();
  const svg=svgs[0];
  if(svg.querySelector('text,tspan,use,image,foreignObject,filter,mask,clipPath,animate,animateTransform'))invalid();
  const titles=svg.querySelectorAll('title'),groups=svg.querySelectorAll('g');
  if(titles.length!==1||groups.length!==1||svg.getAttribute('role')!=='img'||!titles[0].id||svg.getAttribute('aria-labelledby')!==titles[0].id||
    document.querySelectorAll('[id='+JSON.stringify(titles[0].id)+']').length!==1||svg.hasAttribute('aria-label')||svg.getAttribute('aria-hidden')==='true')invalid();
  const group=groups[0],paths=Array.from(group.children);
  if(paths.length===0||paths.length>65536||paths.some(p=>!(p instanceof SVGPathElement))||svg.querySelectorAll('path').length!==paths.length)invalid();
  const screen=svg.getScreenCTM();
  if(!screen||Math.abs(screen.a-1)>1e-6||Math.abs(screen.b)>1e-6||Math.abs(screen.c)>1e-6||Math.abs(screen.d-1)>1e-6)invalid();
  const viewport=svg.getBoundingClientRect();
  if(Math.abs(screen.e-viewport.left)>0.0001||Math.abs(screen.f-viewport.top)>0.0001||
    // Chrome layout quantizes CSS box dimensions to1/64px; native SVG attributes retain floats.
    Math.abs(viewport.width-svg.width.baseVal.value)>1/64+0.0001||Math.abs(viewport.height-svg.height.baseVal.value)>1/64+0.0001)invalid();
  const visible=(element)=>{
    for(let at=element;at;at=at.parentElement){
      const s=getComputedStyle(at),box=at.getBoundingClientRect();
      if(s.display==='none'||s.visibility!=='visible'||Number(s.opacity)<=0||s.contentVisibility==='hidden'||s.clipPath!=='none'||s.maskImage!=='none')invalid();
      // Only this SVG's separately source-matched filter/opacity is represented. Unproven
      // ancestor compositing can erase pixels while geometry, hit tests and AX remain intact.
      if((at!==svg&&s.filter!=='none')||s.backdropFilter!=='none'||s.mixBlendMode!=='normal'||s.clip!=='auto'||
        (at!==svg&&at!==target&&Number(s.opacity)!==1)||
        !['','none'].includes(s.getPropertyValue('-webkit-mask-box-image-source'))||
        !['','none'].includes(s.getPropertyValue('mask-border-source')))invalid();
      for(const name of ['::before','::after']){
        const pseudo=getComputedStyle(at,name);
        if(!['none','normal'].includes(pseudo.content)&&pseudo.display!=='none'&&pseudo.visibility==='visible'&&Number(pseudo.opacity)>0)invalid();
      }
      if(at===element&&(box.width<=0||box.height<=0))invalid();
      const clipX=['hidden','clip','scroll','auto'].includes(s.overflowX),clipY=['hidden','clip','scroll','auto'].includes(s.overflowY);
      if(at!==element&&(clipX||clipY)){
        const glyph=element.getBoundingClientRect();
        if((clipX&&(glyph.left<box.left-0.0001||glyph.right>box.right+0.0001))||
          (clipY&&(glyph.top<box.top-0.0001||glyph.bottom>box.bottom+0.0001)))invalid();
      }
      // Continue above the source root: outer application/body compositing paints it too.
    }
  };
  visible(svg);
  const style=getComputedStyle(svg),parentStyle=getComputedStyle(target);
  const values=paths.map(element=>{
    const path=element,s=getComputedStyle(path),box=path.getBBox(),matrix=path.getScreenCTM();
    visible(path);
    if(!matrix||box.width<=0||box.height<=0||path.children.length||s.filter!=='none'||Number(s.opacity)!==1||getComputedStyle(group).filter!=='none'||Number(getComputedStyle(group).opacity)!==1)invalid();
    const transform=screen.inverse().multiply(matrix);
    const d=path.getAttribute('d');if(!d||d.length>1_048_576)invalid();
    // Computed CSS d can override an unchanged attribute. Compare Chrome's serialized geometry.
    const computed=/^path\("([^"]+)"\)$/u.exec(s.d);
    const token=value=>value.match(/[MLQCZ]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/gu)??[];
    const source=token(d),painted=computed?token(computed[1]):[];
    if(source.length!==painted.length||source.some((v,i)=>/[MLQCZ]/u.test(v)?v!==painted[i]:
      !Number.isFinite(Number(painted[i]))||Math.abs(Number(v)-Number(painted[i]))>Math.max(0.000001,Math.abs(Number(v))*0.000001)))invalid();
    if(s.fillRule!=='nonzero'||s.strokeLinecap!=='butt'||s.strokeLinejoin!=='miter'||s.strokeDasharray!=='none'||s.vectorEffect!=='none')invalid();
    if(Number(s.strokeMiterlimit)!==4)invalid();
    return {d,transform:[transform.a,transform.b,transform.c,transform.d,transform.e,transform.f],
      fill:s.fill,stroke:s.stroke,strokeWidth:Number.parseFloat(s.strokeWidth),fillOpacity:Number(s.fillOpacity),strokeOpacity:Number(s.strokeOpacity),paintOrder:s.paintOrder};
  });
  const clips=[];
  for(let at=svg;at;at=at.parentElement){
    const s=getComputedStyle(at),x=['hidden','clip','scroll','auto'].includes(s.overflowX),y=['hidden','clip','scroll','auto'].includes(s.overflowY);
    if(!x&&!y)continue;
    if(s.transform!=='none'||!['1','normal'].includes(s.zoom)||Number.parseFloat(s.overflowClipMargin)!==0)invalid();
    const box=at.getBoundingClientRect();
    clips.push({x,y,left:box.left+Number.parseFloat(s.borderLeftWidth),right:box.right-Number.parseFloat(s.borderRightWidth),
      top:box.top+Number.parseFloat(s.borderTopWidth),bottom:box.bottom-Number.parseFloat(s.borderBottomWidth)});
  }
  if(clips.length){
    // Rasterize only the observed source paths/styles in native Chrome. No page geometry changes,
    // font substitutions or assumed Gaussian tail radius supply a paint bound.
    const boxes=paths.map(p=>p.getBoundingClientRect()),left=Math.min(...boxes.map(b=>b.left)),top=Math.min(...boxes.map(b=>b.top)),
      right=Math.max(...boxes.map(b=>b.right)),bottom=Math.max(...boxes.map(b=>b.bottom));
    const shadow=/drop-shadow\((rgba?\([^)]*\)) (-?[\d.]+)px (-?[\d.]+)px ([\d.]+)px\)/gu;
    const shadows=[...style.filter.matchAll(shadow)];
    if(style.filter!=='none'&&(!shadows.length||shadows.length>16||style.filter.replace(shadow,'').trim()!==''))invalid();
    const offset=shadows.reduce((n,s)=>n+Math.abs(Number(s[2]))+Math.abs(Number(s[3])),0);
    const stroke=values.reduce((n,p)=>Math.max(n,p.stroke==='none'?0:p.strokeWidth*Math.max(Math.abs(p.transform[0]),Math.abs(p.transform[3]))*4),0);
    const dpr=devicePixelRatio;if(!Number.isFinite(dpr)||dpr<=0||dpr>4)invalid();
    let bound=null,pad=Math.ceil(offset+stroke+2),retry=0;
    while(!bound&&retry++<5){
      const originX=Math.floor((left-pad)*dpr)/dpr,originY=Math.floor((top-pad)*dpr)/dpr,
        width=Math.ceil((right-originX+pad)*dpr),height=Math.ceil((bottom-originY+pad)*dpr);
      if(width<=0||height<=0||width>8192||height>8192||width*height>4194304)invalid();
      const base=new OffscreenCanvas(width,height),ctx=base.getContext('2d');if(!ctx)invalid();
      for(let i=0;i<paths.length;i++){
        const p=values[i],matrix=paths[i].getScreenCTM();if(!matrix)invalid();
        ctx.setTransform(matrix.a*dpr,matrix.b*dpr,matrix.c*dpr,matrix.d*dpr,(matrix.e-originX)*dpr,(matrix.f-originY)*dpr);
        const path=new Path2D(p.d);ctx.lineWidth=p.strokeWidth;ctx.lineCap='butt';ctx.lineJoin='miter';ctx.miterLimit=4;
        if(p.stroke!=='none'){ctx.globalAlpha=p.strokeOpacity;ctx.strokeStyle=p.stroke;ctx.stroke(path);}
        ctx.globalAlpha=p.fillOpacity;ctx.fillStyle=p.fill;ctx.fill(path,'nonzero');
      }
      const painted=new OffscreenCanvas(width,height),paint=painted.getContext('2d',{willReadFrequently:true});if(!paint)invalid();
      paint.filter=style.filter;if(paint.filter!==style.filter)invalid();
      paint.globalAlpha=Number(style.opacity)*(target===svg?1:Number(parentStyle.opacity));paint.drawImage(base,0,0);
      const rgba=paint.getImageData(0,0,width,height).data;let x0=width,y0=height,x1=-1,y1=-1,edge=false;
      for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(rgba[(y*width+x)*4+3]!==0){
        if(x===0||x===width-1||y===0||y===height-1)edge=true;x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);
      }
      if(x1<0)invalid();if(edge){pad*=2;continue;}
      bound={left:originX+x0/dpr,top:originY+y0/dpr,right:originX+(x1+1)/dpr,bottom:originY+(y1+1)/dpr};
    }
    if(!bound)invalid();
    for(const c of clips)if((c.x&&(bound.left<c.left-0.0001||bound.right>c.right+0.0001))||
      (c.y&&(bound.top<c.top-0.0001||bound.bottom>c.bottom+0.0001)))invalid();
  }
  if(!target.isConnected||!svg.isConnected||document.querySelector(input.selector)!==target||!root.contains(target))invalid();
  return {nodeId:input.nodeId,accessibleText:titles[0].textContent,width:svg.width.baseVal.value,height:svg.height.baseVal.value,
    opacity:Number(style.opacity)*(target===svg?1:Number(parentStyle.opacity)),filter:style.filter,visible:true,paths:values};
}`;
export async function observeNativeContours(
  page: Page,
  input: { selector: string; rootNodeId: string; nodeId: string },
): Promise<PortalNativeContourActual> {
  const session = await page.context().newCDPSession(page);
  try {
    const frames = await session.send('Page.getFrameTree');
    const world = await session.send('Page.createIsolatedWorld', {
      frameId: frames.frameTree.frame.id,
      worldName: 'sfp-native-contour-observer',
      grantUniveralAccess: false,
    });
    const result = await session.send('Runtime.evaluate', {
      contextId: world.executionContextId,
      expression: '(' + observe + ')(' + JSON.stringify(input) + ')',
      returnByValue: true,
    });
    if (result.exceptionDetails || !result.result.value)
      throw Error('PORTAL_CONSUMPTION_NATIVE_CONTOUR_MISMATCH');
    const raw = result.result.value as { paths: Array<{ d: string }> };
    if (
      !Array.isArray(raw.paths) ||
      raw.paths.length > 65536 ||
      Buffer.byteLength(JSON.stringify(raw)) > 8_388_608
    )
      throw Error('PORTAL_CONSUMPTION_NATIVE_CONTOUR_MISMATCH');
    const actual = PortalNativeContourActualSchema.parse({
      ...raw,
      // eslint-disable-next-line oxc/no-map-spread -- bounded isolated values are copied and hashed, never modified
      paths: raw.paths.map(({ d, ...path }) => ({ ...path, pathHash: storedChecksum(d) })),
    });
    const reference = await session.send('Runtime.evaluate', {
      contextId: world.executionContextId,
      expression:
        '(()=>{const t=document.querySelector(' +
        JSON.stringify(input.selector) +
        ');return t instanceof SVGSVGElement?t:t?.querySelector("svg")})()',
      returnByValue: false,
    });
    const objectId = reference.result.objectId;
    if (!objectId) throw Error('PORTAL_CONSUMPTION_NATIVE_CONTOUR_MISMATCH');
    try {
      const node = await session.send('DOM.describeNode', { objectId });
      const tree = await session.send('Accessibility.getPartialAXTree', {
        backendNodeId: node.node.backendNodeId,
        fetchRelatives: false,
      });
      const target = tree.nodes.find(n => n.backendDOMNodeId === node.node.backendNodeId);
      if (
        !target ||
        target.ignored ||
        target.role?.value !== 'image' ||
        normalized(target.name?.value) !== normalized(actual.accessibleText)
      )
        throw Error('PORTAL_CONSUMPTION_NATIVE_CONTOUR_MISMATCH');
    } finally {
      await session.send('Runtime.releaseObject', { objectId }).catch(() => {});
    }
    return actual;
  } finally {
    await session.detach().catch(() => {});
  }
}
const normalized = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/gu, ' ').trim() : null);
