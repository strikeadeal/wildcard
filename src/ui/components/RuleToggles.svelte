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
  {#each RULES as rule (rule.key)}
    <label>
      <input
        type="checkbox"
        checked={config[rule.key]}
        disabled={!editable}
        onchange={() => toggle(rule.key)}
      />
      <span>
        <strong>{rule.label}</strong>
        <small>{rule.hint}</small>
      </span>
    </label>
  {/each}
</fieldset>

<style>
  fieldset { border: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px; }
  legend { font-weight: 600; margin-bottom: 8px; padding: 0; }
  label { display: flex; gap: 12px; align-items: center; min-height: 44px; }
  input[type='checkbox'] { width: 22px; height: 22px; min-height: 0; flex-shrink: 0; }
  span { display: flex; flex-direction: column; }
  small { color: var(--muted); }
</style>
