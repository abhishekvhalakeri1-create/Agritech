import './style.css';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// A small, deterministic constellation keeps the sky dreamy without any image assets.
const starsContainer = document.querySelector('#stars');
let seed = 27;
const random = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

for (let i = 0; i < 74; i += 1) {
  const star = document.createElement('span');
  const isCross = i % 17 === 0;
  star.className = `star${isCross ? ' cross' : ''}`;
  star.style.setProperty('--x', `${random() * 100}%`);
  star.style.setProperty('--y', `${random() * 94}%`);
  star.style.setProperty('--size', `${isCross ? 1.2 : 0.6 + random() * 1.4}px`);
  star.style.setProperty('--opacity', `${0.18 + random() * 0.55}`);
  star.style.setProperty('--duration', `${2.8 + random() * 5}s`);
  star.style.setProperty('--delay', `${-random() * 7}s`);
  starsContainer.appendChild(star);
}

class FireworkSky {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.rockets = [];
    this.particles = [];
    this.colors = ['#ffd994', '#f3b765', '#f5a6aa', '#fff1c5', '#d99ac5'];
    this.lastTime = 0;
    this.resize = this.resize.bind(this);
    this.animate = this.animate.bind(this);
    window.addEventListener('resize', this.resize, { passive: true });
    this.resize();
    requestAnimationFrame(this.animate);
  }

  resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  launch(x = this.width * (0.15 + Math.random() * 0.75), targetY = this.height * (0.13 + Math.random() * 0.32), options = {}) {
    if (reduceMotion) return;
    if (this.rockets.length + this.particles.length > 650) return;
    const startX = x + (Math.random() - 0.5) * 80;
    const distance = this.height - targetY;
    this.rockets.push({
      x: startX,
      y: this.height + 8,
      oldX: startX,
      oldY: this.height + 8,
      targetX: x,
      targetY,
      vx: (x - startX) / Math.max(distance / 9, 1),
      vy: -Math.max(8.5, distance / 68),
      color: options.color || this.colors[Math.floor(Math.random() * this.colors.length)],
      heart: options.heart || false,
      small: options.small || false,
    });
  }

  explode(rocket) {
    const count = rocket.small ? 38 : 68;
    const color = rocket.color;

    if (rocket.heart) {
      for (let i = 0; i < 100; i += 1) {
        const t = (i / 100) * Math.PI * 2;
        const hx = 16 * Math.sin(t) ** 3;
        const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
        const velocity = 0.19 + Math.random() * 0.025;
        this.addParticle(rocket.x, rocket.y, hx * velocity, -hy * velocity, i % 4 === 0 ? '#ffd3c2' : '#f08f9f', 0.012, 1.6);
      }
    }

    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.08;
      const speed = (rocket.small ? 1.3 : 2.1) + Math.random() * (rocket.small ? 2 : 3.4);
      const particleColor = Math.random() > 0.82 ? '#fff5d8' : color;
      this.addParticle(rocket.x, rocket.y, Math.cos(angle) * speed, Math.sin(angle) * speed, particleColor, 0.009 + Math.random() * 0.009, 1 + Math.random() * 1.25);
    }

    // Fine golden glitter gives each burst a softer second layer.
    for (let i = 0; i < 22; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.7 + Math.random() * 4.2;
      this.addParticle(rocket.x, rocket.y, Math.cos(angle) * speed, Math.sin(angle) * speed, '#ffe4a5', 0.018 + Math.random() * 0.012, 0.8);
    }
  }

  addParticle(x, y, vx, vy, color, decay, size) {
    this.particles.push({ x, y, oldX: x, oldY: y, vx, vy, color, decay, size, alpha: 1, gravity: 0.035, drag: 0.982 });
  }

  finale() {
    if (reduceMotion) return;
    const points = [
      [0.18, 0.25, false], [0.8, 0.21, false], [0.54, 0.18, true],
      [0.34, 0.37, false], [0.7, 0.39, false], [0.09, 0.46, false],
      [0.91, 0.43, false], [0.48, 0.34, false],
    ];
    points.forEach(([x, y, heart], index) => {
      window.setTimeout(() => this.launch(this.width * x, this.height * y, { heart }), index * 240);
    });
    window.setTimeout(() => {
      this.launch(this.width * 0.25, this.height * 0.18, { small: true });
      this.launch(this.width * 0.75, this.height * 0.16, { small: true });
    }, 2450);
  }

  animate(time) {
    const delta = Math.min((time - this.lastTime) / 16.67 || 1, 2);
    this.lastTime = time;
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.ctx.globalCompositeOperation = 'lighter';

    for (let i = this.rockets.length - 1; i >= 0; i -= 1) {
      const rocket = this.rockets[i];
      rocket.oldX = rocket.x;
      rocket.oldY = rocket.y;
      rocket.x += rocket.vx * delta;
      rocket.y += rocket.vy * delta;
      rocket.vy += 0.025 * delta;

      this.ctx.beginPath();
      this.ctx.moveTo(rocket.oldX, rocket.oldY + 10);
      this.ctx.lineTo(rocket.x, rocket.y);
      this.ctx.strokeStyle = rocket.color;
      this.ctx.globalAlpha = 0.65;
      this.ctx.lineWidth = 1.2;
      this.ctx.stroke();

      if (rocket.y <= rocket.targetY || rocket.vy >= -2.5) {
        this.explode(rocket);
        this.rockets.splice(i, 1);
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const p = this.particles[i];
      p.oldX = p.x;
      p.oldY = p.y;
      p.vx *= p.drag ** delta;
      p.vy = p.vy * p.drag ** delta + p.gravity * delta;
      p.x += p.vx * delta;
      p.y += p.vy * delta;
      p.alpha -= p.decay * delta;

      if (p.alpha <= 0 || p.y > this.height + 30) {
        this.particles.splice(i, 1);
        continue;
      }

      this.ctx.beginPath();
      this.ctx.moveTo(p.oldX - p.vx * 1.4, p.oldY - p.vy * 1.4);
      this.ctx.lineTo(p.x, p.y);
      this.ctx.strokeStyle = p.color;
      this.ctx.globalAlpha = Math.max(0, p.alpha) * 0.88;
      this.ctx.lineWidth = p.size;
      this.ctx.lineCap = 'round';
      this.ctx.stroke();
    }

    this.ctx.globalAlpha = 1;
    this.ctx.globalCompositeOperation = 'source-over';
    requestAnimationFrame(this.animate);
  }
}

const sky = new FireworkSky(document.querySelector('#fireworks'));

if (!reduceMotion) {
  window.setTimeout(() => sky.launch(window.innerWidth * 0.77, window.innerHeight * 0.2, { small: true }), 1500);
  window.setTimeout(() => sky.launch(window.innerWidth * 0.16, window.innerHeight * 0.26, { small: true }), 2900);
  window.setInterval(() => {
    if (!document.hidden && !document.querySelector('#wish-modal').classList.contains('is-open') && Math.random() > 0.35) {
      sky.launch(undefined, undefined, { small: true });
    }
  }, 7200);
}

// A quiet generative bell melody, only started after an explicit user gesture.
class GentleMusic {
  constructor() {
    this.context = null;
    this.timer = null;
    this.step = 0;
    this.playing = false;
    this.pattern = [293.66, 440, 369.99, 493.88, 329.63, 440, 587.33, 369.99, 293.66, 440, 659.25, 493.88, 369.99, 329.63, 293.66, 440];
  }

  setup() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return false;
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.context.destination);

    this.reverb = this.context.createConvolver();
    const length = this.context.sampleRate * 2.3;
    const impulse = this.context.createBuffer(2, length, this.context.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        data[i] = (Math.random() * 2 - 1) * ((1 - i / length) ** 3) * 0.35;
      }
    }
    this.reverb.buffer = impulse;
    this.reverbGain = this.context.createGain();
    this.reverbGain.gain.value = 0.25;
    this.reverb.connect(this.reverbGain);
    this.reverbGain.connect(this.master);
    return true;
  }

  bell(frequency) {
    if (!this.context || !this.playing) return;
    const now = this.context.currentTime;
    const gain = this.context.createGain();
    const oscillator = this.context.createOscillator();
    const harmonic = this.context.createOscillator();
    const harmonicGain = this.context.createGain();
    const pan = this.context.createStereoPanner ? this.context.createStereoPanner() : null;

    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    harmonic.type = 'sine';
    harmonic.frequency.value = frequency * 2.005;
    harmonicGain.gain.value = 0.16;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.6);

    oscillator.connect(gain);
    harmonic.connect(harmonicGain);
    harmonicGain.connect(gain);
    if (pan) {
      pan.pan.value = Math.sin(this.step * 0.8) * 0.3;
      gain.connect(pan);
      pan.connect(this.master);
      pan.connect(this.reverb);
    } else {
      gain.connect(this.master);
      gain.connect(this.reverb);
    }
    oscillator.start(now);
    harmonic.start(now);
    oscillator.stop(now + 2.7);
    harmonic.stop(now + 2.7);
  }

  schedule() {
    if (!this.playing) return;
    this.bell(this.pattern[this.step % this.pattern.length]);
    if (this.step % 4 === 0) this.bell(this.pattern[this.step % this.pattern.length] / 2);
    this.step += 1;
  }

  async toggle() {
    if (!this.context && !this.setup()) return false;
    this.playing = !this.playing;
    if (this.playing) {
      await this.context.resume();
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.setValueAtTime(Math.max(this.master.gain.value, 0.0001), this.context.currentTime);
      this.master.gain.exponentialRampToValueAtTime(0.42, this.context.currentTime + 0.6);
      this.schedule();
      this.timer = window.setInterval(() => this.schedule(), 720);
    } else {
      window.clearInterval(this.timer);
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.setValueAtTime(Math.max(this.master.gain.value, 0.0001), this.context.currentTime);
      this.master.gain.exponentialRampToValueAtTime(0.0001, this.context.currentTime + 0.4);
    }
    return this.playing;
  }
}

const music = new GentleMusic();
const soundToggle = document.querySelector('#sound-toggle');
const soundLabel = document.querySelector('#sound-label');

soundToggle.addEventListener('click', async () => {
  try {
    const isPlaying = await music.toggle();
    soundToggle.setAttribute('aria-pressed', String(isPlaying));
    soundToggle.setAttribute('aria-label', isPlaying ? 'Turn off gentle music' : 'Turn on gentle music');
    soundLabel.textContent = isPlaying ? 'Sound on' : 'Sound off';
  } catch {
    soundLabel.textContent = 'Sound unavailable';
    soundToggle.setAttribute('aria-label', 'Audio is not available in this browser');
  }
});

const wishButton = document.querySelector('#wish-button');
const wishButtonLabel = document.querySelector('#wish-button-label');
const wishModal = document.querySelector('#wish-modal');
const closeButton = document.querySelector('#modal-close');
const returnButton = document.querySelector('#return-button');
const toast = document.querySelector('#toast');
let hasWished = false;
let modalTimer;
let toastTimer;

function openWish() {
  window.clearTimeout(modalTimer);
  wishModal.classList.add('is-open');
  wishModal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  closeButton.focus({ preventScroll: true });
}

function closeWish() {
  wishModal.classList.remove('is-open');
  wishModal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
  wishButton.focus({ preventScroll: true });
}

wishButton.addEventListener('click', () => {
  document.body.classList.add('wish-made');
  sky.finale();
  wishButtonLabel.textContent = hasWished ? 'Light up our sky again' : 'Your wish is among the stars';
  hasWished = true;

  toast.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 3300);

  window.clearTimeout(modalTimer);
  modalTimer = window.setTimeout(openWish, reduceMotion ? 100 : 1900);
});

closeButton.addEventListener('click', closeWish);
returnButton.addEventListener('click', closeWish);
wishModal.querySelector('.modal-backdrop').addEventListener('click', closeWish);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && wishModal.classList.contains('is-open')) closeWish();
  if (event.key === 'Tab' && wishModal.classList.contains('is-open')) {
    const focusable = [closeButton, returnButton];
    if (event.shiftKey && document.activeElement === closeButton) {
      event.preventDefault();
      returnButton.focus();
    } else if (!event.shiftKey && document.activeElement === returnButton) {
      event.preventDefault();
      closeButton.focus();
    }
  }
});

// Pause the melody when the tab is hidden, and resume only if it was explicitly enabled.
document.addEventListener('visibilitychange', () => {
  if (!music.context || !music.playing) return;
  if (document.hidden) {
    window.clearInterval(music.timer);
    music.context.suspend();
  } else {
    music.context.resume().then(() => {
      window.clearInterval(music.timer);
      music.timer = window.setInterval(() => music.schedule(), 720);
    }).catch(() => {});
  }
});
