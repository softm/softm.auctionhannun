window.AUCTIONHANNUN_AD_CONFIG = Object.freeze({
  enabled: true,
  script: "https://t1.kakaocdn.net/kas/static/ba.min.js",
  allowedHosts: Object.freeze(["auctionhannun.designboard.net"]),
  desktopBreakpoint: 768,
  placements: Object.freeze({
    entry: Object.freeze({
      enabled: false, policyApproved: false,
      unit: "DAN-3NtJk6tf5EHgkkOJ", width: 300, height: 250,
      delayMs: 900, cooldownHours: 24
    }),
    infeed: Object.freeze({
      after: 6,
      mobile: Object.freeze({unit: "DAN-5I0qVPgviCSNBEcc", width: 320, height: 100}),
      desktop: Object.freeze({unit: "DAN-CuNtEfgzRE9ZSmn1", width: 728, height: 90})
    }),
    infeed2: Object.freeze({after: 12, unit: "DAN-5I0qVPgviCSNBEcc", width: 320, height: 100}),
    infeed3: Object.freeze({after: 18, unit: "DAN-5I0qVPgviCSNBEcc", width: 320, height: 100}),
    bottom: Object.freeze({
      mobile: Object.freeze({unit: "DAN-ZqOFrLPUmlI5AWvH", width: 320, height: 100}),
      desktop: Object.freeze({unit: "DAN-5dClDD1g2RiGnJwR", width: 728, height: 90})
    })
  })
});
