"use client";

import { useState, useEffect } from "react";

const MOBILE_MAX = 767;
const TABLET_MAX = 1023;

function getBreakpoints() {
  const w = window.innerWidth;
  return { isMobile: w <= MOBILE_MAX, isTablet: w > MOBILE_MAX && w <= TABLET_MAX };
}

export function useMobile() {
  const [state, setState] = useState({ isMobile: false, isTablet: false });

  useEffect(() => {
    const update = () => setState(getBreakpoints());
    update();

    const mobileQuery = window.matchMedia(`(max-width: ${MOBILE_MAX}px)`);
    const tabletQuery = window.matchMedia(`(min-width: ${MOBILE_MAX + 1}px) and (max-width: ${TABLET_MAX}px)`);

    mobileQuery.addEventListener("change", update);
    tabletQuery.addEventListener("change", update);
    return () => {
      mobileQuery.removeEventListener("change", update);
      tabletQuery.removeEventListener("change", update);
    };
  }, []);

  return { ...state, isDesktop: !state.isMobile && !state.isTablet };
}

export default useMobile;
