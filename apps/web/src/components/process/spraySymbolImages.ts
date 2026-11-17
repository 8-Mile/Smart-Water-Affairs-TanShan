import flowMeterUrl from "../../assets/process/spray/flow_meter.png";
import fogCannonUrl from "../../assets/process/spray/fog_cannon.png";
import pressureGaugeUrl from "../../assets/process/spray/pressure_gauge.png";
import waterTankUrl from "../../assets/process/spray/water_tank.png";
import pumpUrl from "../../assets/process/spray/centrifugal_pump.png";
import valveUrl from "../../assets/process/spray/butterfly_valve.png";

export const spraySymbolImages: Partial<Record<string, string>> = {
  fog_cannon: fogCannonUrl,
  water_tank: waterTankUrl,
  centrifugal_pump: pumpUrl,
  pressure_gauge: pressureGaugeUrl,
  flow_meter: flowMeterUrl,
  butterfly_valve: valveUrl,
};
