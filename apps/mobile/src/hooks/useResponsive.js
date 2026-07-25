import { useWindowDimensions } from 'react-native';

/**
 * Shared responsive-layout hook.
 *
 * Breakpoints:
 *   mobile  — width < 600
 *   tablet  — width >= 600 && < 1024
 *   desktop — width >= 1024
 *
 * On desktop web the permanent sidebar is 220px wide, so the actual
 * content area is narrower than the window. `contentWidth` accounts for
 * this so charts and grids size themselves to the real available space.
 *
 * Usage:
 *   const { isTablet, isDesktop, contentWidth, contentMaxWidth, numColumns, gridCols, r } = useResponsive();
 */

const SIDEBAR_WEB = 220; // matches WebLecturerNavigator drawerStyle.width

const useResponsive = () => {
    const { width, height } = useWindowDimensions();

    const isTablet  = width >= 600;
    const isDesktop = width >= 1024;

    // Real drawable content width (excludes the permanent sidebar on desktop)
    const contentWidth = isDesktop ? width - SIDEBAR_WEB : width;

    // Max centred column width — comfortable reading/card width within content area
    const contentMaxWidth = isDesktop
        ? Math.min(1140, contentWidth - 48)
        : isTablet ? Math.min(720, width - 32) : width;

    // Number of card columns for responsive grid layouts
    const gridCols = isDesktop ? 2 : isTablet ? 2 : 1;

    return {
        width,
        height,
        isTablet,
        isDesktop,
        contentWidth,
        contentMaxWidth,
        // FlatList column count (2 on tablet+, 1 on mobile)
        numColumns: isTablet ? 2 : 1,
        // Card grid columns (2 on tablet+)
        gridCols,
        // Scaled design tokens
        r: {
            pad:        isDesktop ? 28 : isTablet ? 24 : 16,
            gap:        isDesktop ? 16 : isTablet ? 14 : 10,
            cardRad:    isDesktop ? 16 : 14,
            titleSize:  isDesktop ? 22 : isTablet ? 20 : 18,
            bodySize:   isDesktop ? 14 : 13,
            labelSize:  isDesktop ? 12 : 11,
            iconSize:   isDesktop ? 22 : 20,
            heroSize:   isDesktop ? 120 : isTablet ? 108 : 96,
            scanFrame:  isDesktop ? 320 : isTablet ? Math.min(280, width * 0.45) : width * 0.6,
        },
    };
};

export default useResponsive;
