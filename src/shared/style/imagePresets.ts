/** Original bundled artwork: no network or external image dependencies. */
const svg = (body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">${body}</svg>`;
export const IMAGE_PRESETS = [
  { id: "coast", label: "Coast", svg: svg('<rect width="1920" height="1080" fill="#dceff3"/><circle cx="1470" cy="230" r="120" fill="#fff2cc"/><path d="M0 500Q450 350 960 520T1920 470V1080H0Z" fill="#a5d5df"/><path d="M0 680Q480 510 1050 720T1920 640V1080H0Z" fill="#5da4bc"/><path d="M0 890Q470 680 1100 930T1920 820V1080H0Z" fill="#28627d"/>') },
  { id: "dunes", label: "Dunes", svg: svg('<rect width="1920" height="1080" fill="#f7e5ce"/><circle cx="450" cy="240" r="130" fill="#e9b46b"/><path d="M0 550Q550 190 1150 650T1920 450V1080H0Z" fill="#dfb08c"/><path d="M0 900Q650 350 1400 770T1920 700V1080H0Z" fill="#c58970"/><path d="M0 950Q800 690 1920 920V1080H0Z" fill="#865c59"/>') },
  { id: "peaks", label: "Peaks", svg: svg('<rect width="1920" height="1080" fill="#e7e5f4"/><circle cx="1440" cy="260" r="110" fill="#fff6e6"/><path d="M0 720L420 250 790 680 1230 340 1920 800V1080H0Z" fill="#b9b4d7"/><path d="M0 940L730 430 1390 890 1710 590 1920 820V1080H0Z" fill="#8585b4"/><path d="M0 1000L500 720 1080 1050 1510 790 1920 970V1080H0Z" fill="#4d587f"/>') },
  { id: "botanical", label: "Botanical", svg: svg('<rect width="1920" height="1080" fill="#e3ece1"/><circle cx="990" cy="570" r="350" fill="#cfddc5"/><g fill="#89aa8f"><ellipse cx="240" cy="300" rx="150" ry="350" transform="rotate(-35 240 300)"/><ellipse cx="1710" cy="790" rx="170" ry="370" transform="rotate(-35 1710 790)"/></g><g fill="#567e6b"><ellipse cx="80" cy="820" rx="200" ry="420" transform="rotate(30 80 820)"/><ellipse cx="1830" cy="250" rx="180" ry="400" transform="rotate(30 1830 250)"/></g><path d="M30 1080Q270 600 0 0M1920 0Q1690 510 1880 1080" fill="none" stroke="#325c4e" stroke-width="10"/>') },
  { id: "paper", label: "Paper", svg: svg('<rect width="1920" height="1080" fill="#eeeae4"/><path d="M0 0H1340L810 1080H0Z" fill="#f8f6f1"/><path d="M1620 0H1920V1080H1080Z" fill="#dbd9d2"/><path d="M1340 0L810 1080M1620 0L1080 1080" stroke="#cecac1" stroke-width="2"/><circle cx="530" cy="350" r="270" fill="#ebe4d9"/>') },
  { id: "orbit", label: "Orbit", svg: svg('<rect width="1920" height="1080" fill="#202941"/><circle cx="1340" cy="510" r="340" fill="#62649b"/><circle cx="1450" cy="420" r="245" fill="#8582b3"/><ellipse cx="1340" cy="550" rx="650" ry="170" transform="rotate(-25 1340 550)" fill="none" stroke="#a5b5d7" stroke-width="28"/><circle cx="270" cy="300" r="90" fill="#d7b89a"/><g fill="#c4cedf"><circle cx="560" cy="130" r="5"/><circle cx="420" cy="840" r="5"/><circle cx="960" cy="190" r="4"/><circle cx="1750" cy="900" r="6"/><circle cx="780" cy="790" r="4"/></g>') },
] as const;
export const COLOR_PRESETS = [
  { name: "Cloud", color: "#f5f6f8" }, { name: "Sand", color: "#eee5d9" },
  { name: "Peach", color: "#f4d5c4" }, { name: "Rose", color: "#ead4df" },
  { name: "Lavender", color: "#d9d7ef" }, { name: "Sky", color: "#cfe2f2" },
  { name: "Mint", color: "#d1e5df" }, { name: "Sage", color: "#b5c7b0" },
  { name: "Ocean", color: "#315b74" }, { name: "Plum", color: "#594763" },
  { name: "Slate", color: "#3d4655" }, { name: "Ink", color: "#161b25" },
] as const;
export const presetImageUrl = (svgContent: string): string => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgContent)}`;
