const fallbackSlides = Array.from({ length: 10 }, (_, index) => ({
  src: `assets/slides/slide-${String(index + 1).padStart(2, "0")}.png`,
}));

const card = document.querySelector("#slideCard");
const images = [
  document.querySelector("#slideImageA"),
  document.querySelector("#slideImageB"),
];
const prevButton = document.querySelector("#prevButton");
const nextButton = document.querySelector("#nextButton");
const fullscreenButton = document.querySelector("#fullscreenButton");
const currentSlide = document.querySelector("#currentSlide");
const totalSlides = document.querySelector("#totalSlides");
const progressTrack = document.querySelector("#progressTrack");
const progressFill = document.querySelector("#progressFill");

let slides = fallbackSlides;
let index = 0;
let activeLayer = 0;
let isTransitioning = false;
const imageCache = new Map();

async function loadManifest() {
  try {
    const response = await fetch("./assets/manifest.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`manifest ${response.status}`);
    }
    const manifest = await response.json();
    if (Array.isArray(manifest.slides) && manifest.slides.length > 0) {
      slides = manifest.slides.map((slide) => ({ src: slide.src }));
    }
  } catch (error) {
    console.warn("Using fallback slide list:", error);
  }
}

function normalizeSrc(src) {
  return src.startsWith("./") ? src : `./${src}`;
}

function ensureImageLoaded(src) {
  const normalized = normalizeSrc(src);
  if (imageCache.has(normalized)) {
    return imageCache.get(normalized);
  }

  const promise = new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(normalized);
    img.onerror = reject;
    img.src = normalized;
  });

  imageCache.set(normalized, promise);
  return promise;
}

function preloadNearby() {
  [index - 1, index + 1, index + 2].forEach((candidate) => {
    if (candidate >= 0 && candidate < slides.length) {
      ensureImageLoaded(slides[candidate].src).catch(() => {});
    }
  });
}

function updateChrome() {
  currentSlide.textContent = String(index + 1).padStart(2, "0");
  totalSlides.textContent = String(slides.length).padStart(2, "0");
  progressFill.style.width = `${((index + 1) / slides.length) * 100}%`;
  progressTrack.setAttribute("aria-valuemax", String(slides.length));
  progressTrack.setAttribute("aria-valuenow", String(index + 1));
  prevButton.disabled = index === 0;
  nextButton.disabled = index === slides.length - 1;
}

async function renderSlide(nextIndex, direction = "next", immediate = false) {
  if (nextIndex < 0 || nextIndex >= slides.length) {
    return;
  }

  if (isTransitioning && !immediate) {
    return;
  }

  const previousIndex = index;
  index = nextIndex;
  updateChrome();

  const nextSrc = await ensureImageLoaded(slides[index].src);
  const incomingLayer = immediate ? activeLayer : 1 - activeLayer;
  const outgoingLayer = activeLayer;
  const incoming = images[incomingLayer];
  const outgoing = images[outgoingLayer];

  incoming.src = nextSrc;
  incoming.alt = `텔레그램 입고 자동화 시스템 ${index + 1}번째 슬라이드`;

  if (immediate) {
    images.forEach((image, layerIndex) => {
      image.classList.toggle("is-active", layerIndex === incomingLayer);
      image.classList.remove("enter-next", "enter-prev");
    });
    card.classList.remove("is-loading");
    activeLayer = incomingLayer;
    preloadNearby();
    return;
  }

  isTransitioning = true;
  const resolvedDirection = direction || (index > previousIndex ? "next" : "prev");
  incoming.classList.remove("enter-next", "enter-prev", "is-active");
  outgoing.classList.remove("enter-next", "enter-prev");
  void incoming.offsetWidth;

  incoming.classList.add("is-active", resolvedDirection === "prev" ? "enter-prev" : "enter-next");
  outgoing.classList.remove("is-active");
  activeLayer = incomingLayer;

  window.setTimeout(() => {
    incoming.classList.remove("enter-next", "enter-prev");
    isTransitioning = false;
    preloadNearby();
  }, 420);
}

function goTo(nextIndex, direction) {
  if (nextIndex === index) {
    return;
  }
  renderSlide(nextIndex, direction);
}

function next() {
  goTo(index + 1, "next");
}

function prev() {
  goTo(index - 1, "prev");
}

function seekFromProgress(clientX) {
  const rect = progressTrack.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  const nextIndex = Math.round(ratio * (slides.length - 1));
  const direction = nextIndex < index ? "prev" : "next";
  goTo(nextIndex, direction);
}

async function toggleFullscreen() {
  if (!document.fullscreenElement) {
    await document.documentElement.requestFullscreen?.();
    fullscreenButton.textContent = "전체화면 종료";
    return;
  }
  await document.exitFullscreen?.();
  fullscreenButton.textContent = "전체화면";
}

prevButton.addEventListener("click", prev);
nextButton.addEventListener("click", next);
fullscreenButton.addEventListener("click", toggleFullscreen);

progressTrack.addEventListener("click", (event) => {
  seekFromProgress(event.clientX);
});

progressTrack.addEventListener("keydown", (event) => {
  if (event.key === "ArrowRight" || event.key === "PageDown") {
    event.preventDefault();
    next();
  }
  if (event.key === "ArrowLeft" || event.key === "PageUp") {
    event.preventDefault();
    prev();
  }
  if (event.key === "Home") {
    event.preventDefault();
    goTo(0, "prev");
  }
  if (event.key === "End") {
    event.preventDefault();
    goTo(slides.length - 1, "next");
  }
});

document.addEventListener("fullscreenchange", () => {
  fullscreenButton.textContent = document.fullscreenElement ? "전체화면 종료" : "전체화면";
});

document.addEventListener("keydown", (event) => {
  if (event.target === progressTrack) {
    return;
  }
  if (event.key === "ArrowRight" || event.key === " " || event.key === "PageDown") {
    event.preventDefault();
    next();
  }
  if (event.key === "ArrowLeft" || event.key === "PageUp") {
    event.preventDefault();
    prev();
  }
  if (event.key.toLowerCase() === "f") {
    event.preventDefault();
    toggleFullscreen();
  }
  if (event.key === "Home") {
    event.preventDefault();
    goTo(0, "prev");
  }
  if (event.key === "End") {
    event.preventDefault();
    goTo(slides.length - 1, "next");
  }
});

let touchStartX = 0;
let touchStartY = 0;

document.addEventListener("touchstart", (event) => {
  const touch = event.changedTouches[0];
  touchStartX = touch.clientX;
  touchStartY = touch.clientY;
}, { passive: true });

document.addEventListener("touchend", (event) => {
  const touch = event.changedTouches[0];
  const dx = touch.clientX - touchStartX;
  const dy = touch.clientY - touchStartY;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) {
    dx < 0 ? next() : prev();
  }
}, { passive: true });

await loadManifest();
updateChrome();
renderSlide(0, "next", true);
