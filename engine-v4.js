/* Border Blitz V4.0 — GPU territory renderer, no framework or CDN needed. */
(function(){
  'use strict';
  const VERTEX = "#version 300 es\nin vec2 a_position;\nvoid main(){gl_Position=vec4(a_position,0.0,1.0);}";
  const FRAGMENT = "#version 300 es\nprecision highp float;\nprecision highp int;\nuniform sampler2D u_owner,u_terrain,u_palette;\nuniform vec2 u_grid,u_view,u_world,u_offset;\nuniform float u_zoom,u_dpr,u_snow;\nout vec4 pixel;\nint ownerAt(ivec2 xy){\n  ivec2 p=clamp(xy,ivec2(0),ivec2(u_grid)-ivec2(1));\n  vec2 rg=texelFetch(u_owner,p,0).rg;\n  return int(round(rg.r*255.0))+256*int(round(rg.g*255.0));\n}\nvoid main(){\n  vec2 screen=vec2(gl_FragCoord.x/u_dpr,u_view.y-gl_FragCoord.y/u_dpr);\n  vec2 world=(screen-u_offset)/u_zoom;\n  if(world.x<0.0||world.y<0.0||world.x>=u_world.x||world.y>=u_world.y){\n    pixel=vec4(.090,.224,.298,1.0);return;\n  }\n  vec2 cell=world/u_world*u_grid;\n  ivec2 ip=ivec2(cell);\n  int owner=ownerAt(ip);\n  vec2 terrain=texelFetch(u_terrain,ip,0).rg;\n  float lift=(terrain.r*255.0-128.0)*.088/255.0,depth=terrain.g*255.0;\n  vec3 rgb;\n  if(owner==0){\n    float shallow=max(0.0,1.0-depth/24.0);\n    rgb=(vec3(13.,46.,77.)+shallow*vec3(34.,77.,79.))/255.0+lift*.44;\n  }else{\n    vec3 base=owner==1?vec3(83.,103.,95.)/255.0:\n      texelFetch(u_palette,ivec2(clamp(owner-2,0,511),0),0).rgb;\n    float sand=max(0.0,1.0-depth/8.0)*.16;\n    float ice=u_snow*max(0.0,(terrain.r*255.0-167.0)/150.0)*.16;\n    vec3 warm=mix(vec3(204.,187.,141.),vec3(227.,236.,240.),u_snow)/255.0;\n    rgb=mix(base+vec3(lift),warm,min(.28,sand+ice));\n    vec2 fractional=fract(cell);\n    float onePixel=clamp(1.2/max(.10,u_zoom*u_world.x/u_grid.x*u_dpr),.08,1.);\n    int l=ownerAt(ip+ivec2(-1,0)),r=ownerAt(ip+ivec2(1,0));\n    int t=ownerAt(ip+ivec2(0,-1)),b=ownerAt(ip+ivec2(0,1));\n    bool border=(l!=owner&&l!=0&&fractional.x<onePixel)||\n       (r!=owner&&r!=0&&fractional.x>1.0-onePixel)||\n       (t!=owner&&t!=0&&fractional.y<onePixel)||\n       (b!=owner&&b!=0&&fractional.y>1.0-onePixel);\n    if(border)rgb=mix(rgb,owner==2?vec3(.69,.94,1.0):vec3(.035,.094,.149),owner==2?.67:.68);\n    bool coast=(l==0&&fractional.x<onePixel)||(r==0&&fractional.x>1.0-onePixel)||\n       (t==0&&fractional.y<onePixel)||(b==0&&fractional.y>1.0-onePixel);\n    if(coast)rgb=mix(rgb,vec3(.85,.89,.70),.43);\n  }\n  pixel=vec4(clamp(rgb,0.0,1.0),1.0);\n}";
  function create(canvas,onLost){
    let gl;
    try{
      gl=canvas.getContext('webgl2',{alpha:false,antialias:false,depth:false,
        stencil:false,preserveDrawingBuffer:false,powerPreference:'high-performance'});
      if(!gl||typeof gl.createShader!=='function'||typeof gl.texSubImage2D!=='function')
        return null;
      function compile(type,source){
        const sh=gl.createShader(type);gl.shaderSource(sh,source);gl.compileShader(sh);
        if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))
          throw Error('shader: '+gl.getShaderInfoLog(sh));
        return sh;
      }
      const p=gl.createProgram(),vs=compile(gl.VERTEX_SHADER,VERTEX),fs=compile(gl.FRAGMENT_SHADER,FRAGMENT);
      gl.attachShader(p,vs);gl.attachShader(p,fs);gl.linkProgram(p);
      if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error('program: '+gl.getProgramInfoLog(p));
      gl.deleteShader(vs);gl.deleteShader(fs);gl.useProgram(p);
      const vbo=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,vbo);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
      const attr=gl.getAttribLocation(p,'a_position');
      gl.enableVertexAttribArray(attr);gl.vertexAttribPointer(attr,2,gl.FLOAT,false,0,0);
      const tex=[gl.createTexture(),gl.createTexture(),gl.createTexture()],uniforms={};
      for(let i=0;i<3;i++){
        gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,tex[i]);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
        gl.uniform1i(gl.getUniformLocation(p,['u_owner','u_terrain','u_palette'][i]),i);
      }
      for(const name of ['u_grid','u_view','u_world','u_offset','u_zoom','u_dpr','u_snow'])
        uniforms[name]=gl.getUniformLocation(p,name);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);gl.disable(gl.DEPTH_TEST);
      const gpu={gl,p,vbo,tex,uniforms,ready:false,width:0,height:0,cols:0,rows:0,
        owners:null,dirty:new Map(),scratch:new Uint8Array(0),
        stats:{frames:0,uploads:0,uploadCells:0,rebuilds:0}};
      gpu.reset=function(){
        gpu.ready=false;gpu.dirty.clear();
      };
      gpu.start=function(tiles,relief,shore,colors,cols,rows){
        gpu.ready=false;gpu.cols=cols;gpu.rows=rows;
        const N=cols*rows,ownerPixels=new Uint8Array(N*2),terrain=new Uint8Array(N*2);
        for(let i=0;i<N;i++){
          const value=tiles[i]+2,j=i*2;
          ownerPixels[j]=value&255;ownerPixels[j+1]=value>>8;
          terrain[j]=relief[i];terrain[j+1]=shore[i];
        }
        const palette=new Uint8Array(512*4);
        for(let i=0;i<Math.min(colors.length,512);i++)
          palette.set([colors[i][0],colors[i][1],colors[i][2],255],i*4);
        gpu.owners=ownerPixels;gpu.dirty.clear();
        for(let i=0;i<3;i++){
          gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,tex[i]);
          if(i===2)gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,512,1,0,gl.RGBA,gl.UNSIGNED_BYTE,palette);
          else gl.texImage2D(gl.TEXTURE_2D,0,gl.RG8,cols,rows,0,gl.RG,gl.UNSIGNED_BYTE,i===0?ownerPixels:terrain);
        }
        gpu.ready=true;gpu.stats.rebuilds++;
      };
      gpu.mark=function(i,owner){
        if(!gpu.ready)return;
        const v=owner+2,j=i*2;
        gpu.owners[j]=v&255;gpu.owners[j+1]=v>>8;
        const y=i/gpu.cols|0,x=i%gpu.cols,bin=y/192|0;
        const row=gpu.dirty.get(bin);
        if(row){
          if(x<row[0])row[0]=x;if(x>row[1])row[1]=x;
          if(y<row[2])row[2]=y;if(y>row[3])row[3]=y;
        }else gpu.dirty.set(bin,[x,x,y,y]);
      };
      gpu.draw=function(view){
        if(!gpu.ready)return;
        const cols=gpu.cols,rows=gpu.rows;
        if(gpu.dirty.size){
          gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,tex[0]);
          for(const r of gpu.dirty.values()){
            const x=r[0],y=r[2],w=r[1]-x+1,h=r[3]-y+1,n=w*h*2;
            if(gpu.scratch.length<n)gpu.scratch=new Uint8Array(n);
            const copy=gpu.scratch.subarray(0,n);
            for(let line=0;line<h;line++){
              const offset=((y+line)*cols+x)*2;
              copy.set(gpu.owners.subarray(offset,offset+w*2),line*w*2);
            }
            gl.texSubImage2D(gl.TEXTURE_2D,0,x,y,w,h,gl.RG,gl.UNSIGNED_BYTE,copy);
            gpu.stats.uploads++;gpu.stats.uploadCells+=w*h;
          }
          gpu.dirty.clear();
        }
        const dpr=view.dpr,w=Math.round(view.width*dpr),h=Math.round(view.height*dpr);
        if(gpu.width!==w||gpu.height!==h){
          canvas.width=w;canvas.height=h;gl.viewport(0,0,w,h);
          gpu.width=w;gpu.height=h;
        }
        gl.useProgram(p);gl.bindBuffer(gl.ARRAY_BUFFER,vbo);
        const u=uniforms;
        gl.uniform2f(u.u_grid,cols,rows);gl.uniform2f(u.u_view,view.width,view.height);
        gl.uniform2f(u.u_world,view.worldW,view.worldH);
        gl.uniform2f(u.u_offset,view.offsetX,view.offsetY);
        gl.uniform1f(u.u_zoom,view.zoom);gl.uniform1f(u.u_dpr,dpr);
        gl.uniform1f(u.u_snow,view.snow?1:0);
        gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
        gpu.stats.frames++;
      };
      canvas.addEventListener('webglcontextlost',function(e){
        e.preventDefault();gpu.ready=false;onLost?.();
      });
      return gpu;
    }catch(e){
      console.warn('Border Blitz GPU indisponible, fallback Canvas2D:',e);
      return null;
    }
  }
  window.BBRendererV4={create};
})();