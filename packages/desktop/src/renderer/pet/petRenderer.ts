// Modified from AionUI by WINK GO contributors in 2026.
const LOAD_TIMEOUT = 3000;
const FADE_MS = 150;
const PET_STATES_BASE_PATH = '../pet-states-doraemon-v1';
const PET_DISPLAY_SCALE_PERCENT = 72;
const PET_DISPLAY_INSET_PERCENT = (100 - PET_DISPLAY_SCALE_PERCENT) / 2;
let currentObject: HTMLImageElement | null = document.getElementById('pet') as HTMLImageElement;

function getStateAssetPath(state: string): string {
  return `${PET_STATES_BASE_PATH}/${state}.png`;
}

function setupTransitions(target: HTMLImageElement | null): void {
  if (!target) return;
  target.style.position = 'absolute';
  target.style.inset = `${PET_DISPLAY_INSET_PERCENT}%`;
  target.style.width = `${PET_DISPLAY_SCALE_PERCENT}%`;
  target.style.height = `${PET_DISPLAY_SCALE_PERCENT}%`;
  target.style.objectFit = 'contain';
  target.style.transformOrigin = '50% 55%';
}

/**
 * Load a new pet state and cross-fade it over the previous one. The old object
 * is removed only after the fade completes, so there's no white flash between
 * states. If the new asset fails to load within LOAD_TIMEOUT we bail out silently
 * and keep showing the previous state.
 */
function loadPetAsset(assetPath: string): void {
  const newObj = document.createElement('img');
  newObj.id = 'pet';
  newObj.alt = '';
  setupTransitions(newObj);
  newObj.style.opacity = '0';
  newObj.style.transition = `opacity ${FADE_MS}ms ease-out`;
  newObj.src = assetPath;

  let loaded = false;
  const timeout = setTimeout(() => {
    if (!loaded) {
      newObj.remove();
    }
  }, LOAD_TIMEOUT);

  newObj.addEventListener('load', () => {
    loaded = true;
    clearTimeout(timeout);
    setupTransitions(newObj);

    const oldObj = currentObject;
    // Clear the old id immediately so duplicate #pet selectors (from CSS and
    // setupTransitions' query) never see two elements at once during the fade.
    if (oldObj) oldObj.removeAttribute('id');
    currentObject = newObj;

    // Trigger the fade on the next frame so the browser has painted the
    // initial opacity:0 state — otherwise the transition is skipped and the
    // swap is instant.
    requestAnimationFrame(() => {
      newObj.style.opacity = '1';
      if (oldObj) oldObj.style.opacity = '0';
    });

    // Remove the old object after the cross-fade completes. Keep a reference
    // via closure so we don't race with another state change in the meantime.
    if (oldObj) {
      setTimeout(() => {
        oldObj.remove();
      }, FADE_MS);
    }
  });

  document.body.appendChild(newObj);
}

// The initial asset is hard-coded in pet.html without any transition setup or
// positioning — mirror the runtime swap target so subsequent cross-fades work
// and eye/body transforms animate from the start.
if (currentObject) {
  setupTransitions(currentObject);
  currentObject.style.transition = `opacity ${FADE_MS}ms ease-out`;
  currentObject.addEventListener('load', () => {
    setupTransitions(currentObject);
  });
}

window.petAPI.onStateChange((state: string) => {
  loadPetAsset(getStateAssetPath(state));
});

window.petAPI.onEyeMove(({ eyeDx, eyeDy, bodyDx, bodyRotate }) => {
  if (!currentObject) return;
  const horizontal = bodyDx + eyeDx * 0.2;
  const vertical = eyeDy * 0.12;
  currentObject.style.transform = `translate(${horizontal}px, ${vertical}px) rotate(${bodyRotate}deg)`;
});
