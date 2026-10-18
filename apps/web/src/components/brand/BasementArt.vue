<script setup lang="ts">
import { useId } from 'vue'

// Board panel 08 ("Ánh đèn dưới hầm"): halftone pink dots, warm light down a basement arch. Decorative only.
// Fixed colours: it is always a picture of the dark basement, in either theme.
const id = useId()
const dots = `ht-${id}`
const fade = `fade-${id}`
const mask = `mask-${id}`
const door = `door-${id}`
</script>

<template>
  <svg viewBox="0 0 496 363" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <defs>
      <pattern :id="dots" width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="3.5" cy="3.5" r="1.7" fill="#ff7a90" /></pattern>
      <radialGradient :id="fade" cx="248" cy="250" r="240" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#fff" stop-opacity="0.85" />
        <stop offset="1" stop-color="#fff" stop-opacity="0" />
      </radialGradient>
      <mask :id="mask"><rect width="496" height="363" :fill="`url(#${fade})`" /></mask>
      <radialGradient :id="door" cx="248" cy="300" r="170" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#ff7a90" />
        <stop offset="0.5" stop-color="#8a4a42" />
        <stop offset="1" stop-color="#2a1d16" />
      </radialGradient>
    </defs>
    <rect width="496" height="363" fill="#17110e" />
    <rect width="496" height="363" :fill="`url(#${dots})`" :mask="`url(#${mask})`" opacity="0.32" />
    <g stroke="#3a2d26" stroke-width="1">
      <line x1="188" y1="190" x2="0" y2="52" />
      <line x1="308" y1="190" x2="496" y2="52" />
      <line x1="188" y1="300" x2="0" y2="330" />
      <line x1="308" y1="300" x2="496" y2="330" />
    </g>
    <path d="M188 300V190a60 60 0 0 1 120 0v110Z" :fill="`url(#${door})`" />
    <circle cx="248" cy="160" r="20" fill="#ff7a90" opacity="0.18" />
    <circle cx="248" cy="160" r="6.5" fill="#ff7a90" />
    <polygon points="188,300 308,300 318,316 178,316" fill="#3a2d26" />
    <polygon points="178,316 318,316 332,336 164,336" fill="#2a1f19" />
    <polygon points="164,336 332,336 350,363 146,363" fill="#3a2d26" />
    <g stroke="#ff7a90" stroke-width="1.5">
      <line x1="188" y1="300" x2="308" y2="300" opacity="0.7" />
      <line x1="178" y1="316" x2="318" y2="316" opacity="0.45" />
      <line x1="164" y1="336" x2="332" y2="336" opacity="0.25" />
    </g>
  </svg>
</template>
