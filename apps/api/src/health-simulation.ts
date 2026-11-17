import { asOf, type HealthMode, type HealthTelemetry } from "@water/contracts";
export function healthSimulation(mode: HealthMode): HealthTelemetry {
  const end = Date.parse(asOf);
  const samples = Array.from({length: 48}, (_,i) => {
    const wave = Math.sin(i * Math.PI / 3) * 0.025;
    const deteriorating = mode === "degrading" || (mode === "recovered" && i < 32);
    return {
      at: new Date(end - (47-i)*3600000).toISOString(), operating: true,
      vibration: Number((deteriorating ? 1.55 + i*0.051 : 1.55+wave).toFixed(3)),
      temperature: Number((deteriorating ? 48+i*0.46 : 48+wave*8).toFixed(2)),
      current: Number((deteriorating ? 91+i*0.65 : 91+wave*12).toFixed(2)),
    };
  });
  return { mode, starts: 520, samples, ...(mode === "recovered" ? { maintenanceAt: samples[32]!.at } : {}) };
}
