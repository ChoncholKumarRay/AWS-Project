export type RandomWalkMetric = {
  value: number;
  min: number;
  max: number;
  step: number;
};

export function nextRandomWalkValue(
  metric: RandomWalkMetric,
  random = Math.random
) {
  const delta = (random() * 2 - 1) * metric.step;
  return clamp(Math.round(metric.value + delta), metric.min, metric.max);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
