export type TitlebarQuickAction = 'workspace' | 'model' | 'permission';

type TitlebarQuickActionDetail = {
  action: TitlebarQuickAction | null;
};

const TITLEBAR_QUICK_ACTION_EVENT = 'winkgo:titlebar-quick-action';

export const dispatchTitlebarQuickAction = (action: TitlebarQuickAction) => {
  window.dispatchEvent(
    new CustomEvent<TitlebarQuickActionDetail>(TITLEBAR_QUICK_ACTION_EVENT, {
      detail: { action },
    })
  );
};

export const dismissTitlebarQuickActionTargets = () => {
  window.dispatchEvent(
    new CustomEvent<TitlebarQuickActionDetail>(TITLEBAR_QUICK_ACTION_EVENT, {
      detail: { action: null },
    })
  );
};

export const addTitlebarQuickActionVisibilityListener = (
  action: TitlebarQuickAction,
  listener: (visible: boolean) => void
) => {
  const handleAction = (event: Event) => {
    listener((event as CustomEvent<TitlebarQuickActionDetail>).detail?.action === action);
  };

  window.addEventListener(TITLEBAR_QUICK_ACTION_EVENT, handleAction);
  return () => window.removeEventListener(TITLEBAR_QUICK_ACTION_EVENT, handleAction);
};
