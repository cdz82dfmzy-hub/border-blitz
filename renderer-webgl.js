/* Border Blitz V4.0.2 — GPU territory renderer.
   WebGL2 layer for land/water/realm pixels; 2D canvas remains for labels and ships.
   World simulation and ownership remain authoritative in the game engine. */
(function(global){
'use strict';
class BorderBlitzGpuRenderer {
  constructor(canvas,cols,rows,tiles,relief,depth,colors,snow){
    this.canvas=canvas;this.cols=cols;this.rows=rows;this.snow=!!snow;
    this.gl=canvas.getContext('webgl2',{
      alpha:false,antialias:false,depth:false,stencil:false,
      premultipliedAlpha:false,preserveDrawingBuffer:false,
      powerPreference:'high-performance'
    });
    const gl=this.gl;
    if(!gl)throw new Error('WebGL2 absent');
    if(gl.getParameter(gl.MAX_TEXTURE_SIZE)<Math.max(cols,rows))throw new Error('Texture HD non prise en charge');
    this.calls=0;this.pixels=0;this.frames=0;this.skippedFrames=0;
    this.ready=true;this.hasFrame=false;this.dirty=false;
    this.ownerPixels=new Uint8Array(cols*rows*4);
    for(let i=0;i<tiles.length;i++)this.encode(i,tiles[i]);
    const reliefPixels=new Uint8Array(cols*rows*4);
    for(let i=0;i<tiles.length;i++){
      const j=i*4;reliefPixels[j]=relief[i];reliefPixels[j+1]=depth[i];reliefPixels[j+3]=255;
    }
    const palette=new Uint8Array(512*4);
    for(let i=0;i<colors.length&&i<500;i++){
      const j=(i+2)*4;
      palette[j]=colors[i][0];palette[j+1]=colors[i][1];palette[j+2]=colors[i][2];palette[j+3]=255;
    }
    palette[4]=83;palette[5]=103;palette[6]=95;palette[7]=255;
    palette[0]=13;palette[1]=46;palette[2]=77;palette[3]=255;
    this.program=this.makeProgram();
    this.vao=gl.createVertexArray();gl.bindVertexArray(this.vao);
    this.textureOwners=this.makeTexture(0,cols,rows,this.ownerPixels);
    this.textureRelief=this.makeTexture(1,cols,rows,reliefPixels);
    this.texturePalette=this.makeTexture(2,512,1,palette);
    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program,'uOwners'),0);
    gl.uniform1i(gl.getUniformLocation(this.program,'uRelief'),1);
    gl.uniform1i(gl.getUniformLocation(this.program,'uPalette'),2);
    gl.uniform2f(gl.getUniformLocation(this.program,'uGrid'),cols,rows);
    gl.uniform1f(gl.getUniformLocation(this.program,'uSnow'),this.snow?1:0);
    this.uCanvas=gl.getUniformLocation(this.program,'uCanvas');
    this.uCss=gl.getUniformLocation(this.program,'uCss');
    this.uOffset=gl.getUniformLocation(this.program,'uOffset');
    this.uWorld=gl.getUniformLocation(this.program,'uWorld');
    this.uZoom=gl.getUniformLocation(this.program,'uZoom');
    // Groupes de lignes sales : aucun grand rectangle n'est imposé avant estimation.
    this.rowMin=new Int32Array(rows);this.rowMax=new Int32Array(rows);
    this.rowMin.fill(cols);this.rowMax.fill(-1);
  }
  encode(i,owner){
    const v=owner+2,j=i*4;
    this.ownerPixels[j]=v&255;this.ownerPixels[j+1]=v>>8;this.ownerPixels[j+2]=0;this.ownerPixels[j+3]=255;
  }
  makeTexture(unit,w,h,data){
    const gl=this.gl,t=gl.createTexture();gl.activeTexture(gl.TEXTURE0+unit);
    gl.bindTexture(gl.TEXTURE_2D,t);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,data);
    return t;
  }
  makeProgram(){
    const gl=this.gl;
    const vertex=`#version 300 es
      precision highp float;
      void main(){
        vec2 p=gl_VertexID==0?vec2(-1.,-1.):gl_VertexID==1?vec2(3.,-1.):vec2(-1.,3.);
        gl_Position=vec4(p,0.,1.);
      }`;
    const fragment=`#version 300 es
      precision highp float;
      precision highp int;
      uniform sampler2D uOwners;
      uniform sampler2D uRelief;
      uniform sampler2D uPalette;
      uniform vec2 uCanvas;
      uniform vec2 uCss;
      uniform vec2 uOffset;
      uniform vec2 uWorld;
      uniform vec2 uGrid;
      uniform float uZoom;
      uniform float uSnow;
      out vec4 outColor;
      int territory(ivec2 cell){
        if(any(lessThan(cell,ivec2(0)))||any(greaterThanEqual(cell,ivec2(uGrid))))return 0;
        vec4 b=texelFetch(uOwners,cell,0);
        return int(floor(b.r*255.+.5))+int(floor(b.g*255.+.5))*256;
      }
      void main(){
        vec2 scr=vec2(gl_FragCoord.x*uCss.x/uCanvas.x,
                      (uCanvas.y-gl_FragCoord.y)*uCss.y/uCanvas.y);
        vec2 map=(scr-uOffset)/uZoom * uGrid/uWorld;
        ivec2 cell=ivec2(floor(map));
        if(any(lessThan(cell,ivec2(0)))||any(greaterThanEqual(cell,ivec2(uGrid)))){
          outColor=vec4(.0902,.2235,.298,1.);
          return;
        }
        int id=territory(cell);
        vec2 r=texelFetch(uRelief,cell,0).rg*255.;
        float lift=(r.x-128.)*.088/255.;
        float depth=r.y;
        vec3 color;
        if(id==0){
          float shallow=max(0.,1.-depth/24.);
          color=(vec3(13.,46.,77.)+vec3(34.,77.,79.)*shallow)/255.+lift*.44;
        }else{
          vec3 base=texelFetch(uPalette,ivec2(clamp(id,0,511),0),0).rgb;
          float sand=max(0.,1.-depth/8.)*.16;
          float ice=uSnow*max(0.,(r.x-167.)/150.)*.16;
          float mixValue=min(.28,sand+ice);
          vec3 warm=mix(vec3(204.,187.,141.),vec3(227.,236.,240.),uSnow)/255.;
          color=mix(base+vec3(lift),warm,mixValue);
          bool border=false;
          if(cell.x>0){int n=territory(cell+ivec2(-1,0));border=border||(n!=id&&n!=0);}
          if(cell.x<int(uGrid.x)-1){int n=territory(cell+ivec2(1,0));border=border||(n!=id&&n!=0);}
          if(cell.y>0){int n=territory(cell+ivec2(0,-1));border=border||(n!=id&&n!=0);}
          if(cell.y<int(uGrid.y)-1){int n=territory(cell+ivec2(0,1));border=border||(n!=id&&n!=0);}
          if(border){
            vec3 stroke=id==2?vec3(.6745,.941,1.):vec3(.0314,.094,.149);
            color=mix(color,stroke,id==2?.64:.64);
          }
          if(depth<1.){
            color=mix(color,vec3(.85,.87,.70),.22);
          }
        }
        outColor=vec4(clamp(color,0.,1.),1.);
      }`;
    const compile=(kind,src)=>{
      const sh=gl.createShader(kind);gl.shaderSource(sh,src);gl.compileShader(sh);
      if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))
        throw new Error('Shader GPU : '+gl.getShaderInfoLog(sh));
      return sh;
    };
    const a=compile(gl.VERTEX_SHADER,vertex),b=compile(gl.FRAGMENT_SHADER,fragment);
    const p=gl.createProgram();gl.attachShader(p,a);gl.attachShader(p,b);gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS))
      throw new Error('Lien WebGL2 : '+gl.getProgramInfoLog(p));
    gl.deleteShader(a);gl.deleteShader(b);
    return p;
  }
  mark(i,owner){
    this.encode(i,owner);
    const y=(i/this.cols)|0,x=i-y*this.cols;
    if(x<this.rowMin[y])this.rowMin[y]=x;
    if(x>this.rowMax[y])this.rowMax[y]=x;
    this.dirty=true;
  }
  upload(){
    if(!this.dirty)return;
    const gl=this.gl,cols=this.cols,rows=this.rows;
    // Sélection au coût estimé : transferts de pixels + coût fixe des appels GL.
    // La copie complète reste un candidat : pas de surcoût catastrophique
    // lorsque 500 fronts couvrent presque toute la carte.
    const callCost=4096;
    let best=null,bestCost=cols*rows+callCost;
    for(const span of [1,16,64,256]){
      const rects=[];let area=0;
      for(let base=0;base<rows;base+=span){
        const end=Math.min(base+span,rows);
        let x0=cols,x1=-1,y0=rows,y1=-1;
        for(let y=base;y<end;y++){
          if(this.rowMax[y]<0)continue;
          if(this.rowMin[y]<x0)x0=this.rowMin[y];
          if(this.rowMax[y]>x1)x1=this.rowMax[y];
          if(y<y0)y0=y;
          y1=y;
        }
        if(x1<0)continue;
        rects.push([x0,y0,x1-x0+1,y1-y0+1]);
        area+=(x1-x0+1)*(y1-y0+1);
      }
      const cost=area+rects.length*callCost;
      if(cost<bestCost){bestCost=cost;best=rects;}
    }
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.textureOwners);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH,cols);
    const rects=best||[[0,0,cols,rows]];
    for(const r of rects){
      const x=r[0],y=r[1],w=r[2],h=r[3];
      gl.pixelStorei(gl.UNPACK_SKIP_PIXELS,x);
      gl.pixelStorei(gl.UNPACK_SKIP_ROWS,y);
      gl.texSubImage2D(gl.TEXTURE_2D,0,x,y,w,h,gl.RGBA,gl.UNSIGNED_BYTE,this.ownerPixels);
      this.calls++;this.pixels+=w*h;
    }
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS,0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS,0);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH,0);
    this.rowMin.fill(cols);this.rowMax.fill(-1);this.dirty=false;
  }
  resize(w,h){
    if(this.canvas.width!==w||this.canvas.height!==h)this.hasFrame=false;
    if(this.canvas.width!==w)this.canvas.width=w;
    if(this.canvas.height!==h)this.canvas.height=h;
    this.gl.viewport(0,0,w,h);
  }
  render(cssW,cssH,worldW,worldH,offsetX,offsetY,zoom){
    if(!this.ready)return false;
    if(this.hasFrame&&!this.dirty&&
       this.lastCssW===cssW&&this.lastCssH===cssH&&
       this.lastWorldW===worldW&&this.lastWorldH===worldH&&
       this.lastOffsetX===offsetX&&this.lastOffsetY===offsetY&&this.lastZoom===zoom){
      this.skippedFrames++;return false;
    }
    const gl=this.gl;
    this.upload();
    gl.viewport(0,0,this.canvas.width,this.canvas.height);
    gl.useProgram(this.program);gl.bindVertexArray(this.vao);
    gl.uniform2f(this.uCanvas,this.canvas.width,this.canvas.height);
    gl.uniform2f(this.uCss,cssW,cssH);
    gl.uniform2f(this.uOffset,offsetX,offsetY);
    gl.uniform2f(this.uWorld,worldW,worldH);
    gl.uniform1f(this.uZoom,zoom);
    gl.drawArrays(gl.TRIANGLES,0,3);
    this.frames++;this.hasFrame=true;
    this.lastCssW=cssW;this.lastCssH=cssH;
    this.lastWorldW=worldW;this.lastWorldH=worldH;
    this.lastOffsetX=offsetX;this.lastOffsetY=offsetY;this.lastZoom=zoom;
    return true;
  }
  dispose(){
    this.ready=false;const gl=this.gl;if(!gl)return;
    gl.deleteTexture(this.textureOwners);gl.deleteTexture(this.textureRelief);
    gl.deleteTexture(this.texturePalette);gl.deleteVertexArray(this.vao);gl.deleteProgram(this.program);
  }
}
global.BorderBlitzGpuRenderer=BorderBlitzGpuRenderer;
})(window);
