import { useWindowDimensions } from 'react-native';

export function useResponsive() {
  const { width, height } = useWindowDimensions();

  const isWideDesktop = width >= 1380;
  const isDesktop = width >= 1024;
  const isTablet = width >= 768 && width < 1024;
  const isMobile = width < 768;

  // Grid column count based on viewport width
  const gridColumns = width >= 1380 ? 3 : width >= 860 ? 2 : 1;

  return {
    width,
    height,
    isWideDesktop,
    isDesktop,
    isTablet,
    isMobile,
    gridColumns,
    maxContainerStyle: isDesktop
      ? { maxWidth: 1440, width: '100%' as const, alignSelf: 'center' as const }
      : { width: '100%' as const },
    modalContainerStyle: isDesktop
      ? { maxWidth: 1080, width: '100%' as const, alignSelf: 'center' as const }
      : { width: '100%' as const },
  };
}
