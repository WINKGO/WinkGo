import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const STORAGE_KEY = 'winkgo.focus-timer.v1';
const DEFAULT_MINUTES = 25;

interface PersistedFocusTimer {
  minutes: number;
  remainingSeconds: number;
  deadline: number;
  running: boolean;
}

const sanitizeMinutes = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(180, Math.max(1, Math.round(parsed))) : DEFAULT_MINUTES;
};

const readPersistedTimer = (): PersistedFocusTimer => {
  const fallback: PersistedFocusTimer = {
    minutes: DEFAULT_MINUTES,
    remainingSeconds: DEFAULT_MINUTES * 60,
    deadline: 0,
    running: false,
  };
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as Partial<PersistedFocusTimer> | null;
    if (!value) return fallback;
    const minutes = sanitizeMinutes(value.minutes);
    const deadline = Number(value.deadline) || 0;
    const running = value.running === true && deadline > Date.now();
    const deadlineSeconds = running ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : 0;
    return {
      minutes,
      remainingSeconds: running
        ? deadlineSeconds
        : Math.min(minutes * 60, Math.max(0, Number(value.remainingSeconds) || minutes * 60)),
      deadline: running ? deadline : 0,
      running,
    };
  } catch {
    return fallback;
  }
};

const persistTimer = (value: PersistedFocusTimer) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
};

export const formatFocusDuration = (seconds: number): string => {
  const safe = Math.max(0, Math.round(seconds));
  return `${Math.floor(safe / 60)
    .toString()
    .padStart(2, '0')}:${(safe % 60).toString().padStart(2, '0')}`;
};

export const useIslandFocusTimer = (onCompleted: () => void) => {
  const [timer, setTimer] = useState<PersistedFocusTimer>(readPersistedTimer);
  const completionHandledRef = useRef(false);
  const onCompletedRef = useRef(onCompleted);
  onCompletedRef.current = onCompleted;

  useEffect(() => {
    persistTimer(timer);
  }, [timer]);

  useEffect(() => {
    if (!timer.running) {
      completionHandledRef.current = false;
      return undefined;
    }

    const updateRemaining = () => {
      const remainingSeconds = Math.max(0, Math.ceil((timer.deadline - Date.now()) / 1000));
      if (remainingSeconds > 0) {
        setTimer((current) =>
          current.running && current.remainingSeconds !== remainingSeconds ? { ...current, remainingSeconds } : current
        );
        return;
      }

      setTimer((current) => ({ ...current, remainingSeconds: 0, deadline: 0, running: false }));
      if (!completionHandledRef.current) {
        completionHandledRef.current = true;
        onCompletedRef.current();
      }
    };

    updateRemaining();
    const interval = window.setInterval(updateRemaining, 1_000);
    return () => window.clearInterval(interval);
  }, [timer.deadline, timer.running]);

  const setMinutes = useCallback((nextValue: number) => {
    setTimer((current) => {
      if (current.running) return current;
      const minutes = sanitizeMinutes(nextValue);
      return {
        minutes,
        remainingSeconds: minutes * 60,
        deadline: 0,
        running: false,
      };
    });
  }, []);

  const startOrPause = useCallback(() => {
    setTimer((current) => {
      if (current.running) {
        return {
          ...current,
          remainingSeconds: Math.max(0, Math.ceil((current.deadline - Date.now()) / 1000)),
          deadline: 0,
          running: false,
        };
      }
      const remainingSeconds = current.remainingSeconds > 0 ? current.remainingSeconds : current.minutes * 60;
      return {
        ...current,
        remainingSeconds,
        deadline: Date.now() + remainingSeconds * 1_000,
        running: true,
      };
    });
  }, []);

  const reset = useCallback(() => {
    setTimer((current) => ({
      ...current,
      remainingSeconds: current.minutes * 60,
      deadline: 0,
      running: false,
    }));
  }, []);

  return useMemo(
    () => ({
      ...timer,
      formattedRemaining: formatFocusDuration(timer.remainingSeconds),
      progress:
        timer.minutes > 0
          ? Math.max(0, Math.min(100, ((timer.minutes * 60 - timer.remainingSeconds) / (timer.minutes * 60)) * 100))
          : 0,
      setMinutes,
      startOrPause,
      reset,
    }),
    [reset, setMinutes, startOrPause, timer]
  );
};
