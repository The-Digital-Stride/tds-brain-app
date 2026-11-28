import { useEffect, useRef } from 'react';
import { PERFORMANCE_VIEWERS } from '../../../shared/performance-contract.ts';
import { SheetBar } from '../shell/SheetBar.tsx';
import { SheetTabs } from '../shell/SheetTabs.tsx';
import { type SettingsTab, settingsTabOrDefault, visibleSettingsTabs } from '../shell/settings-tabs.ts';
import { useLastSync } from '../shell/useLastSync.ts';
import { healthChecks, healthSummary } from '../state/health.ts';
import { useStore } from '../store.tsx';
import { SettingsView } from './SettingsView.tsx';

/** Frames a focus request waits for the sheet to stop being inert (about half a second). */
const INERT_WAIT_FRAMES = 30;

/**
 * The Settings sheet (plan 2026-11-20-settings-tabs): the bar, the tab row and the shown tab's page. The health
 * checks and the focus request live here, outside the page that is keyed by tab, so a tab press keeps focus on the
 * pressed tab, the sync poll runs once, and a focus request is settled (and cleared) whichever tab it names.
 */
export function SettingsSheet() {
  const { boot, streamUp, lists, skillLevels, settingsTab, openSettings, settingsFocus, clearSettingsFocus } =
    useStore();
  const { lastSync, now } = useLastSync();
  const role = boot?.identity.role;
  const tabCtx = {
    hasSkillLevels: Boolean(skillLevels),
    hasPerformance: role !== undefined && (PERFORMANCE_VIEWERS as readonly string[]).includes(role),
  };
  const tab: SettingsTab = settingsTabOrDefault(settingsTab, tabCtx);
  const checks = boot ? healthChecks({ boot, streamUp, lists, lastSync, now }) : undefined;
  const summary = checks ? healthSummary(checks) : null;
  const items = visibleSettingsTabs(tabCtx).map((t) =>
    t.id === 'health' && summary?.state === 'problem'
      ? { id: t.id, label: t.label, dot: 'bad' as const, spoken: `${t.label}, ${summary.text}` }
      : { id: t.id, label: t.label },
  );
  const title = items.find((t) => t.id === tab)?.label ?? '';
  const ready = Boolean(boot);

  // One focus effect: focus the control, else the fallback, and always clear the request. While the control sits
  // in an inert page (a closing drawer or to-do panel still covers the sheet), it waits a few frames, since focus()
  // there does nothing; it gives up after about half a second.
  useEffect(() => {
    if (!settingsFocus || !ready) return;
    const id = settingsFocus;
    let frame = 0;
    let tries = 0;
    const land = () => {
      const el =
        document.getElementById(id) ??
        // In Automatic level there is no Model box: land on the chosen Level option instead.
        (id === 'set-model'
          ? document.querySelector<HTMLElement>('.level-mode [role="radio"][aria-checked="true"]')
          : null);
      if (el?.closest('[inert]') && tries++ < INERT_WAIT_FRAMES) {
        frame = requestAnimationFrame(land);
        return;
      }
      el?.focus();
      el?.scrollIntoView?.({ block: 'center' });
      clearSettingsFocus();
    };
    land();
    return () => cancelAnimationFrame(frame);
  }, [settingsFocus, ready, clearSettingsFocus]);

  // The current tab scrolls into view when the row is cut off (narrow sheet).
  const navRef = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tab` is the trigger; the effect reads the DOM's current tab.
  useEffect(() => {
    navRef.current
      ?.querySelector<HTMLElement>('[aria-current="page"]')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [tab]);

  return (
    <>
      <SheetBar title="Settings" titleHidden={`: ${title}`} />
      <div className="page-tabs" ref={navRef}>
        <SheetTabs
          className="tool-tabs seg"
          label="Settings sections"
          items={items}
          current={tab}
          onChoose={(id) => openSettings(id as SettingsTab)}
        />
      </div>
      <div className="sheet-scroll" key={tab}>
        <SettingsView tab={tab} checks={checks} />
      </div>
    </>
  );
}
