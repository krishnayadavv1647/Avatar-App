import { useEffect, useRef } from "react";
import clsx from "clsx";
import { avatarApi } from "@/services/avatar.api";
import { linkApi } from "@/services/link.api";

/**
 * The connecting animation: while a call is being set up, the avatar's picture
 * pulls in from its card into a wobbling glass bubble - refracted, with an
 * iridescent rim and a soft glow - and when the call connects the bubble swells
 * back out into the sharp card the live video then takes over from.
 *
 * It is drawn in WebGL over the call frame (the canvas is bigger than the frame
 * so the glow has room), and is only ever a flourish: if WebGL is missing it
 * reports `onUnsupported` and the call screen carries on without it.
 *
 * State is one of "calling" (the bubble) or "connected" (back to the card). The
 * values chase their targets with springs, so a state change in the middle of
 * the animation eases rather than jumps.
 */
export const ORB_PAD = 60; // css px of clear room around the card, for the glow

const VS = `attribute vec2 p; varying vec2 v; void main(){ v=p*0.5+0.5; gl_Position=vec4(p,0.,1.); }`;

const FS = `
#extension GL_OES_standard_derivatives : enable
precision mediump float;
varying vec2 v;
uniform sampler2D u_tex;
uniform vec2  u_res;      // canvas px
uniform float u_pad;      // clear padding px (room for the glow)
uniform float u_radius;   // the card's corner radius px, to match the frame
uniform float u_imgAR;    // picture aspect w/h
uniform float u_t;        // animation phase (speed-scaled time)
uniform float u_morph;    // 0 = rounded card, 1 = circle bubble
uniform float u_ring;     // 0..1 iridescent ring + glow
uniform float u_blur;     // px blur radius
uniform float u_lens;     // 0..1 refraction strength

vec3 spectrum(float ph){                     // soft thin-film rainbow
  vec3 c = vec3(.84,.91,1.03) + vec3(.28,.02,-.26)*cos(ph);
  c += vec3(.10,-.05,.12)*cos(2.*ph+1.2);
  return max(c, 0.);
}
float sdBox(vec2 p, vec2 b, float r){ vec2 q=abs(p)-b+r; return length(max(q,0.))+min(max(q.x,q.y),0.)-r; }
vec2 mirror01(vec2 u){ return 1.-abs(1.-mod(u,2.)); }

vec3 sampleImg(vec2 uv){                     // cover-fit + golden-angle blur
  vec2 box = u_res - 2.*u_pad; float boxAR = box.x/box.y;
  vec2 s = boxAR>u_imgAR ? vec2(1., u_imgAR/boxAR) : vec2(boxAR/u_imgAR, 1.);
  vec2 base = (uv-.5)*s+.5;
  vec3 acc=vec3(0.); float r = u_blur/box.y;
  for(int i=0;i<16;i++){
    float fi=float(i); float a=fi*2.39996; float rr=sqrt((fi+.5)/16.)*r;
    acc += texture2D(u_tex, mirror01(base+vec2(cos(a),sin(a))*rr)).rgb;
  }
  return acc/16.;
}

void main(){
  vec2 px = v*u_res - u_res*.5;
  vec2 hb = (u_res-2.*u_pad)*.5;
  float R0 = min(hb.x,hb.y)*.78;
  float rho = length(px); vec2 dir = rho>1e-4 ? px/rho : vec2(1.,0.);

  float w = sin(5.*dir.x+2.*dir.y+u_t*1.1)*.5 + sin(3.*dir.x-6.*dir.y-u_t*.85)*.35 + sin(1.2*dir.x+2.3*dir.y+u_t*.4)*.15;
  w = w*.5+.5;
  float pulse = mix(.75,1.,.5+.5*sin(u_t*1.7));
  float pinch = min(u_morph*(.04+.08*w),.12)*pulse;
  float dCircle = rho - R0*(1.-pinch);
  float dCard   = sdBox(px, hb, u_radius);
  float d = mix(dCard, dCircle, smoothstep(0.,1.,u_morph));

#ifdef GL_OES_standard_derivatives
  float aa = max(fwidth(d),1e-3);
#else
  float aa = 1.5;
#endif
  float alpha = 1.-smoothstep(-aa,aa,d);

  float ang = atan(px.y,px.x);
  if(alpha<.001){
    float reach = 26.*(1.+.22*sin(2.*ang+u_t*.5)+.12*sin(5.*ang-u_t*.31));
    float amp = .55*u_ring*exp(-max(d,0.)/reach)*(1.-smoothstep(0.,reach*2.4,d));
    vec3 tint = mix(vec3(1.), spectrum(ang+u_t*.38), .45)*(.62+.16*sin(3.*ang-u_t));
    gl_FragColor = vec4(tint*amp, amp); return;
  }

  vec2 uv = px/(hb*2.)+.5;
  float rn = clamp(rho/R0,0.,1.);
  float k = u_lens*u_morph;
  vec2 bent = dir*pow(rn, 1.+1.6*k)*R0;
  vec2 uvL = mix(uv, bent/(hb*2.)+.5, k);
  float disp = k*smoothstep(.55,1.,rn)*.035;
  vec3 col;
  col.r = sampleImg(uvL+dir*disp).r;
  col.g = sampleImg(uvL).g;
  col.b = sampleImg(uvL-dir*disp).b;

  float edgePx = max(-d,0.);
  float fres = exp(-edgePx/18.)*u_morph;
  col = mix(col, col*.55, fres*.6);
  col += vec3(1.)*.10*u_morph*smoothstep(.3,1.,-dir.y)*pow(rn,3.);

  float band = smoothstep(0.,2.,edgePx)*(1.-smoothstep(4.,22.,edgePx));
  float ph = ang + edgePx*.07 + u_t*.38;
  vec3 irid = mix(vec3(1.), spectrum(ph), .72);
  irid = mix(irid, vec3(1.), .5*exp(-edgePx/2.));
  float ringAmp = clamp(band*u_ring*.9,0.,1.);
  col = mix(col, col*irid + irid*.18, ringAmp);

  gl_FragColor = vec4(col*alpha, alpha);
}`;

/** Where each value is heading in each state. */
const TARGETS = {
  calling: { morph: 1, ring: 1, blur: 16, speed: 1.6 },
  connected: { morph: 0, ring: 0, blur: 0, speed: 0.4 },
};
// Starts as the sharp card, so it takes over seamlessly from the picture the page was showing.
const START = { morph: 0, ring: 0, blur: 0, speed: 0.4 };
const LENS = 0.9;

// ---- the picture --------------------------------------------------------------

/**
 * Where a call's picture comes from: `{ key, load, name }`. `load` returns the
 * picture as a Blob from our own API, because a canvas refuses a picture from
 * another origin unless that host allows it. A signed-in call and a share-link
 * call have different doors to the same picture, hence the indirection.
 */
export const avatarFace = (avatar) => ({
  key: `${avatar._id}:${avatar.previewUrl}`,
  load: () => avatarApi.previewImage(avatar._id),
  name: avatar.name,
});

/** The same, for someone with only a share link. */
export const linkFace = (token, avatar) => ({
  key: `link:${token}:${avatar.previewUrl}`,
  load: () => linkApi.previewImage(token),
  name: avatar.name,
});

const faces = new Map();

/**
 * Fetches the picture ahead of time, so the bubble has it the moment it is
 * needed. If that fails (a clip instead of a picture, an offline host) a drawn
 * placeholder stands in: the animation is the point, not the exact face.
 */
export function warmFace(face) {
  if (!faces.has(face.key)) faces.set(face.key, loadFace(face));
  return faces.get(face.key);
}

async function loadFace(face) {
  try {
    const url = URL.createObjectURL(await face.load());
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    return { source: img, ratio: img.naturalWidth / img.naturalHeight };
  } catch {
    return placeholder(face);
  }
}

function placeholder(face) {
  const c = document.createElement("canvas");
  c.width = 300;
  c.height = 400;
  const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, 0, 400);
  g.addColorStop(0, "#3b4a5c");
  g.addColorStop(1, "#16181d");
  x.fillStyle = g;
  x.fillRect(0, 0, 300, 400);
  x.fillStyle = "rgba(255,255,255,.85)";
  x.font = "600 150px system-ui, sans-serif";
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText((face.name || "?").trim()[0]?.toUpperCase() || "?", 150, 210);
  return { source: c, ratio: 0.75 };
}

// ---- WebGL --------------------------------------------------------------------

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
  return shader;
}

/** The program and its texture, or null if this browser cannot do it. */
function createRenderer(canvas) {
  const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true });
  if (!gl) return null;

  let program;
  try {
    gl.getExtension("OES_standard_derivatives");
    program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("link failed");
  } catch (err) {
    // The page goes on without the animation; the reason is for whoever wonders why it is missing.
    console.warn("Call animation unavailable:", err.message);
    return null;
  }
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "p");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const uniform = {};
  for (const name of ["u_res", "u_pad", "u_radius", "u_imgAR", "u_t", "u_morph", "u_ring", "u_blur", "u_lens"]) {
    uniform[name] = gl.getUniformLocation(program, name);
  }

  const texture = gl.createTexture();
  let ratio = 0.75;
  let hasPicture = false;

  return {
    get ready() {
      return hasPicture;
    },
    setPicture(source, pictureRatio) {
      try {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        ratio = pictureRatio;
        hasPicture = true;
      } catch {
        hasPicture = false;
      }
    },
    draw({ width, height, pad, radius, time, morph, ring, blur }) {
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (!hasPicture) return;
      gl.uniform2f(uniform.u_res, width, height);
      gl.uniform1f(uniform.u_pad, pad);
      gl.uniform1f(uniform.u_radius, radius);
      gl.uniform1f(uniform.u_imgAR, ratio);
      gl.uniform1f(uniform.u_t, time);
      gl.uniform1f(uniform.u_morph, morph);
      gl.uniform1f(uniform.u_ring, ring);
      gl.uniform1f(uniform.u_blur, blur);
      gl.uniform1f(uniform.u_lens, LENS);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    destroy() {
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      // The context itself is left alone: in development React runs an effect twice on the
      // same canvas, and a context that has been lost cannot be taken from it again. The
      // canvas goes with the component, and its context with it.
    },
  };
}

// ---- the component ---------------------------------------------------------------

/**
 * @param {{ face: { key: string, load: () => Promise<Blob>, name: string },
 *           state: "calling" | "connected", fading?: boolean, radius?: number,
 *           onReady?: () => void, onSettled?: () => void, onUnsupported?: () => void }} props
 *   `radius`: the frame's corner radius in css px, to match it; defaults to the call frame's.
 *   `onReady`: the first frame with the picture is on screen (the page can hide its own copy).
 *   `onSettled`: back to a sharp card after "connected" - time to reveal what is underneath.
 *   `fading`: fade the canvas out (its CSS transition does the rest).
 */
export default function CallOrb({ face, state, fading = false, radius, onReady, onSettled, onUnsupported }) {
  const canvas = useRef(null);
  // The latest props, read by the animation loop without restarting it.
  const live = useRef({});
  live.current = { state, radius, onReady, onSettled, onUnsupported };

  useEffect(() => {
    const renderer = createRenderer(canvas.current);
    if (!renderer) {
      live.current.onUnsupported?.();
      return undefined;
    }

    let stopped = false;
    let frameId;
    let settled = false;
    let announced = false;
    let phase = 0;
    let last = performance.now();
    const cur = { ...START };

    warmFace(face).then((picture) => {
      if (!stopped) renderer.setPicture(picture.source, picture.ratio);
    });

    const frame = (now) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      const target = TARGETS[live.current.state] || TARGETS.calling;
      for (const key of Object.keys(target)) {
        cur[key] += (target[key] - cur[key]) * (1 - Math.exp(-dt * (key === "morph" ? 4.5 : 3.5)));
      }
      phase += dt * cur.speed; // accumulated, so a speed change never makes the wobble jump

      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const width = Math.round(canvas.current.clientWidth * dpr);
      const height = Math.round(canvas.current.clientHeight * dpr);
      if (canvas.current.width !== width || canvas.current.height !== height) {
        canvas.current.width = width;
        canvas.current.height = height;
      }
      const corner = live.current.radius ?? (window.matchMedia("(min-width: 640px)").matches ? 40 : 28); // the frame's own radius

      renderer.draw({
        width,
        height,
        pad: ORB_PAD * dpr,
        radius: corner * dpr,
        time: phase,
        morph: cur.morph,
        ring: cur.ring,
        blur: cur.blur * dpr,
      });

      if (renderer.ready && !announced) {
        announced = true;
        live.current.onReady?.();
      }
      if (!settled && live.current.state === "connected" && cur.morph < 0.02 && cur.blur < 0.4) {
        settled = true;
        live.current.onSettled?.();
      }
      frameId = requestAnimationFrame(frame);
    };
    frameId = requestAnimationFrame(frame);

    return () => {
      stopped = true;
      cancelAnimationFrame(frameId);
      renderer.destroy();
    };
    // One animation per picture; the rest is read from `live`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [face.key]);

  return (
    <div aria-hidden className="pointer-events-none absolute z-10" style={{ inset: -ORB_PAD }}>
      <canvas ref={canvas} className={clsx("h-full w-full transition-opacity duration-300", fading && "opacity-0")} />
    </div>
  );
}
