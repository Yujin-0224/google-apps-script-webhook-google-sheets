const slides = Array.from({ length: 10 }, (_, index) => ({
  src: `./assets/slides/slide-${String(index + 1).padStart(2, "0")}.png`,
}));

const image = document.querySelector("#slideImage");
const card = document.querySelector("#slideCard");
const prevButton = document.querySelector("#prevButton");
const nextButton = document.querySelector("#nextButton");
const fullscreenButton = document.querySelector("#fullscreenButton");
const currentSlide = document.querySelector("#currentSlide");
const totalSlides = document.querySelector("#totalSlides");
const progressFill = document.querySelector("#progressFill");

let index = 0;
let isAnimating = false;

totalSlides.textContent = String(slides.length).padStart(2, "0");

function preloadSlides() {
  slides.forEach((slide) => {
    const img = new Image();
    img.src = slide.src;
  });
}

function updateUi(direction = "next") {
  const slide = slides[index];
  isAnimating = true;
  card.classList.remove("enter-next", "enter-prev", "flash", "is-loading");
  void card.offsetWidth;
  card.classList.add(direction === "prev" ? "enter-prev" : "enter-next", "flash");
  image.src = slide.src;
  image.alt = `텔레그램 입고 자동화 시스템 ${index + 1}번째 슬라이드`;

  currentSlide.textContent = String(index + 1).padStart(2, "0");
  progressFill.style.width = `${((index + 1) / slides.length) * 100}%`;
  prevButton.disabled = index === 0;
  nextButton.disabled = index === slides.length - 1;

  window.setTimeout(() => {
    isAnimating = false;
    card.classList.remove("enter-next", "enter-prev", "flash");
  }, 650);
}

function goTo(nextIndex, direction) {
  if (isAnimating || nextIndex < 0 || nextIndex >= slides.length || nextIndex === index) {
    return;
  }
  index = nextIndex;
  updateUi(direction);
}

function next() {
  goTo(index + 1, "next");
}

function prev() {
  goTo(index - 1, "prev");
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

document.addEventListener("fullscreenchange", () => {
  fullscreenButton.textContent = document.fullscreenElement ? "전체화면 종료" : "전체화면";
});

document.addEventListener("keydown", (event) => {
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

preloadSlides();
updateUi("next");
