const fallbackVideos = Array.from({ length: 15 }, (_, index) => ({
  src: `assets/videos/video-${String(index + 1).padStart(2, "0")}.mp4`,
  title: String(index + 1),
}));

const card = document.querySelector("#slideCard");
const videos = [
  document.querySelector("#slideVideoA"),
  document.querySelector("#slideVideoB"),
];
const prevButton = document.querySelector("#prevButton");
const nextButton = document.querySelector("#nextButton");
const fullscreenButton = document.querySelector("#fullscreenButton");
const currentSlide = document.querySelector("#currentSlide");
const totalSlides = document.querySelector("#totalSlides");
const progressTrack = document.querySelector("#progressTrack");
const progressFill = document.querySelector("#progressFill");

let slides = fallbackVideos;
let index = 0;
let activeLayer = 0;
let isTransitioning = false;

async function loadManifest() {
  try {
    const response = await fetch("./assets/manifest.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`manifest ${response.status}`);
    }
    const manifest = await response.json();
    if (Array.isArray(manifest.videos) && manifest.videos.length > 0) {
      slides = manifest.videos.map((video) => ({
        src: video.src,
        title: video.title || "",
      }));
    }
  } catch (error) {
    console.warn("Using fallback video list:", error);
  }
}

function normalizeSrc(src) {
  return src.startsWith("./") ? src : `./${src}`;
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

function stopVideo(video) {
  video.pause();
  video.removeAttribute("src");
  video.load();
}

async function playFromStart(video) {
  video.currentTime = 0;
  try {
    await video.play();
  } catch (error) {
    console.warn("Video autoplay was blocked:", error);
  }
}

function waitForVideoReady(video) {
  if (video.readyState >= 2) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      video.removeEventListener("loadeddata", finish);
      video.removeEventListener("canplay", finish);
      video.removeEventListener("error", finish);
      window.clearTimeout(timeoutId);
      resolve();
    };
    const timeoutId = window.setTimeout(finish, 1200);
    video.addEventListener("loadeddata", finish, { once: true });
    video.addEventListener("canplay", finish, { once: true });
    video.addEventListener("error", finish, { once: true });
  });
}

function preloadNearby() {
  [index + 1, index + 2].forEach((candidate) => {
    if (candidate >= 0 && candidate < slides.length) {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.muted = true;
      video.src = normalizeSrc(slides[candidate].src);
    }
  });
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

  const incomingLayer = immediate ? activeLayer : 1 - activeLayer;
  const outgoingLayer = activeLayer;
  const incoming = videos[incomingLayer];
  const outgoing = videos[outgoingLayer];
  const current = slides[index];

  incoming.loop = false;
  incoming.muted = true;
  incoming.playsInline = true;
  incoming.src = normalizeSrc(current.src);
  incoming.setAttribute("aria-label", current.title || `발표 영상 ${index + 1}`);
  incoming.load();

  await waitForVideoReady(incoming);

  if (immediate) {
    videos.forEach((video, layerIndex) => {
      video.classList.toggle("is-active", layerIndex === incomingLayer);
      video.classList.remove("enter-next", "enter-prev");
      if (layerIndex !== incomingLayer) {
        stopVideo(video);
      }
    });
    card.classList.remove("is-loading");
    activeLayer = incomingLayer;
    await playFromStart(incoming);
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
  stopVideo(outgoing);
  activeLayer = incomingLayer;
  await playFromStart(incoming);

  window.setTimeout(() => {
    incoming.classList.remove("enter-next", "enter-prev");
    isTransitioning = false;
    preloadNearby();
  }, 420);
}

function goTo(nextIndex, direction) {
  if (nextIndex === index) {
    renderSlide(nextIndex, direction, true);
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

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    renderSlide(index, "next", true);
    return;
  }
  videos[activeLayer].pause();
});

async function init() {
  await loadManifest();
  updateChrome();
  renderSlide(0, "next", true);
}

init();
