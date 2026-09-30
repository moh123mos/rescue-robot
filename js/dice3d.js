/* dice3d.js — نرد ثلاثي الأبعاد (Three.js). النتيجة تُحسم مسبقاً ثم يُحرَّك الهبوط عليها. */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
// ترتيب وجوه BoxGeometry: +x, -x, +y, -y, +z, -z  (كل وجهين متقابلين مجموعهما 7)
const FACE_VALUES = [3, 4, 1, 6, 2, 5];
const NORMALS = { 3: [1, 0, 0], 4: [-1, 0, 0], 1: [0, 1, 0], 6: [0, -1, 0], 2: [0, 0, 1], 5: [0, 0, -1] };
const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let renderer, scene, camera, dice, shadow, canvas, raf = 0, inited = false;

function faceTexture(v) {
  const c = document.createElement("canvas"); c.width = c.height = 256; const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, 256, 256); g.addColorStop(0, "#ffffff"); g.addColorStop(1, "#ddd7cb");
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  for (const k of PIPS[v]) {
    const cx = 54 + (k % 3) * 74, cy = 54 + Math.floor(k / 3) * 74;
    const r = x.createRadialGradient(cx - 4, cy - 4, 2, cx, cy, 26); r.addColorStop(0, "#555"); r.addColorStop(1, "#050505");
    x.fillStyle = r; x.beginPath(); x.arc(cx, cy, v === 1 ? 34 : 24, 0, 7); x.fill();
  }
  const t = new THREE.CanvasTexture(c); t.anisotropy = 8; t.colorSpace = THREE.SRGBColorSpace; return t;
}

function init() {
  if (inited) return; inited = true;
  canvas = document.getElementById("dice3d");
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(34, 1, .1, 100);
  scene.add(new THREE.AmbientLight(0xffffff, 1.1));
  const key = new THREE.DirectionalLight(0xfff2d6, 2.4); key.position.set(-4, 9, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(0x9ed0ff, 1.0); rim.position.set(6, 3, -4); scene.add(rim);
  const mats = FACE_VALUES.map(v => new THREE.MeshPhysicalMaterial({ map: faceTexture(v), roughness: .28, metalness: 0, clearcoat: .8, clearcoatRoughness: .15 }));
  dice = new THREE.Mesh(new RoundedBoxGeometry(2, 2, 2, 5, .3), mats); scene.add(dice);
  // ظل ناعم على الأرض
  const sc = document.createElement("canvas"); sc.width = sc.height = 128; const sx = sc.getContext("2d");
  const gr = sx.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, "rgba(0,0,0,.55)"); gr.addColorStop(1, "rgba(0,0,0,0)"); sx.fillStyle = gr; sx.fillRect(0, 0, 128, 128);
  shadow = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = .01; scene.add(shadow);
  resize(); window.addEventListener("resize", resize);
}
function resize() {
  if (!renderer) return;
  const w = window.innerWidth, h = window.innerHeight; renderer.setSize(w, h, false);
  camera.aspect = w / h; const dist = w / h < .8 ? 15.5 : 11; camera.position.set(0, dist * .86, dist * .62 + 2); camera.lookAt(0, .6, 0); camera.updateProjectionMatrix();
}
function render() { renderer.render(scene, camera); }
function screenToPlane(cx, cy, planeY) {
  const v = new THREE.Vector3((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1, .5).unproject(camera);
  const dir = v.sub(camera.position).normalize(); const t = (planeY - camera.position.y) / dir.y;
  return camera.position.clone().add(dir.multiplyScalar(t));
}

/* value: 1..6 (محسومة مسبقاً)، targetRect: مستطيل منطقة النرد في الشاشة */
async function roll(value, targetRect, sfx) {
  init(); canvas.style.display = "block";
  const gsap = window.gsap;
  const n = new THREE.Vector3(...NORMALS[value]);
  const qFinal = new THREE.Quaternion().setFromUnitVectors(n, new THREE.Vector3(0, 1, 0));
  qFinal.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - .5) * 1.2));
  const axis = new THREE.Vector3(Math.random() - .5, Math.random() - .3, Math.random() - .5).normalize();
  const spinTotal = (reduced ? 2 : 7) * Math.PI;
  const st = { p: 0, y: 7, x: -3.2 - Math.random(), z: -1.5, s: 1, spin: 1 };
  dice.visible = shadow.visible = true; dice.scale.setScalar(1);
  const apply = () => {
    dice.position.set(st.x, st.y, st.z);
    const spinQ = new THREE.Quaternion().setFromAxisAngle(axis, spinTotal * st.spin);
    dice.quaternion.copy(qFinal).multiply(spinQ);
    dice.scale.setScalar(st.s);
    const h = Math.max(0, st.y - 1 * st.s); const k = Math.max(.3, 1 - h / 9);
    shadow.position.set(st.x, .01, st.z); shadow.scale.setScalar(k * st.s); shadow.material.opacity = .9 * k * Math.min(1, st.s);
    render();
  };
  const loop = () => { raf = requestAnimationFrame(loop); apply(); };
  loop();
  sfx && sfx.diceRoll();
  const hit = (v) => sfx && sfx.diceHit(v);
  await new Promise(res => {
    const tl = gsap.timeline({ onComplete: res });
    tl.to(st, { y: 1, duration: .48, ease: "power2.in" }, 0)
      .to(st, { x: 0, z: 0, duration: 1.45, ease: "power2.out" }, 0)
      .to(st, { spin: 0, duration: 1.45, ease: "power2.out" }, 0)
      .call(() => hit(1)).to(st, { y: 3.2, duration: .3, ease: "power2.out" })
      .to(st, { y: 1, duration: .3, ease: "power2.in" }).call(() => hit(.7))
      .to(st, { y: 1.9, duration: .2, ease: "power2.out" }).to(st, { y: 1, duration: .2, ease: "power2.in" }).call(() => hit(.4))
      .to(st, { y: 1.35, duration: .12, ease: "power2.out" }).to(st, { y: 1, duration: .12, ease: "power2.in" });
  });
  await new Promise(r => setTimeout(r, reduced ? 250 : 650));
  // يصغر ويطير إلى منطقة النرد
  if (targetRect) {
    const tp = screenToPlane(targetRect.left + targetRect.width / 2, targetRect.top + targetRect.height / 2, 1);
    const scl = Math.max(.12, Math.min(.5, targetRect.width / window.innerWidth * 6));
    await new Promise(res => gsap.timeline({ onComplete: res })
      .to(st, { x: tp.x, z: tp.z, y: tp.y + 2.5, s: scl, duration: .5, ease: "power2.inOut" })
    );
  }
  cancelAnimationFrame(raf); dice.visible = shadow.visible = false; renderer.clear(); canvas.style.display = "none";
  return value;
}

window.Dice3D = { roll, init };
window.dispatchEvent(new Event("dice3d-ready"));
