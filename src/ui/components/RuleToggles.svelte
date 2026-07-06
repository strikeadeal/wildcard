<script lang="ts">
  import type { RuleConfig } from '../../engine/types';

  let { config, editable, onchange }: {
    config: RuleConfig;
    editable: boolean;
    onchange: (config: RuleConfig) => void;
  } = $props();

  const RULES: { key: keyof RuleConfig; label: string; hint: string }[] = [
    { key: 'stacking', label: 'Stacking', hint: 'Answer a +2 with a +2 (and +4 with +4) — the pile passes on' },
    { key: 'jumpIn', label: 'Jump-in', hint: 'Holding the exact same card? Slam it down out of turn' },
    { key: 'drawUntilPlayable', label: 'Draw to match', hint: 'Keep drawing until you can play, instead of drawing one' },
    { key: 'sevenZero', label: '7-0', hint: 'A 7 swaps hands with someone; a 0 passes all hands around' }
  ];

  function toggle(key: keyof RuleConfig) {
    onchange({ ...config, [key]: !config[key] });
  }
</script>

<fieldset>
  <legend>House rules</legend>
  <div class="rules">
    {#each RULES as rule (rule.key)}
      <label class:on={config[rule.key]} class:locked={!editable}>
        <span class="text">
          <strong>{rule.label}</strong>
          <small>{rule.hint}</small>
        </span>
        <input
          type="checkbox"
          checked={config[rule.key]}
          disabled={!editable}
          onchange={() => toggle(rule.key)}
        />
      </label>
    {/each}
  </div>
</fieldset>

<style>
  fieldset { border: none; padding: 0; margin: 0; min-width: 0; }
  legend {
    font-family: var(--display);
    font-weight: 600;
    font-size: 1.1rem;
    padding: 0;
    margin-bottom: 10px;
  }
  .rules { display: flex; flex-direction: column; gap: 8px; }
  label {
    display: flex;
    gap: 12px;
    align-items: center;
    min-height: 44px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 10px 14px;
    transition: border-color 0.15s ease, background 0.15s ease;
  }
  label.on { border-color: rgb(55 176 107 / 0.6); background: var(--surface-2); }
  label.locked { opacity: 0.75; }
  .text { display: flex; flex-direction: column; gap: 2px; flex: 1; }
  .text strong { font-weight: 600; }
  small { color: var(--muted); font-size: 0.82rem; line-height: 1.35; }
  input[type='checkbox'] {
    width: 26px;
    height: 26px;
    min-height: 0;
    flex-shrink: 0;
    accent-color: var(--card-green);
    cursor: pointer;
  }
  input:disabled { cursor: default; }
</style>
