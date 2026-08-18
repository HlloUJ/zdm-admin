import { useCascaderAreaData } from '@vant/area-data';

export interface ChinaRegionOption {
  text: string;
  value: string;
  children?: ChinaRegionOption[];
}

export const chinaRegionOptions = useCascaderAreaData() as ChinaRegionOption[];

export const chinaRegionKeys = {
  label: 'text',
  value: 'value',
  children: 'children',
} as const;

const legacyRegionCodeMap: Record<string, string> = {
  tianhe: '440106',
  panyu: '440113',
  chancheng: '440604',
  nanhai: '440605',
  xihu: '330106',
  binjiang: '330108',
  yinzhou: '330212',
  haishu: '330203',
  sip: '320571',
  wuzhong: '320506',
  jianye: '320105',
  qinhuai: '320104',
};

export const normalizeChinaRegionCode = (value: string) => legacyRegionCodeMap[value] ?? value;

export const getChinaRegionLabel = (value: string) => {
  const normalizedValue = normalizeChinaRegionCode(value);

  for (const province of chinaRegionOptions) {
    for (const city of province.children ?? []) {
      const district = city.children?.find((item) => item.value === normalizedValue);
      if (district) return `${province.text}${city.text}${district.text}`;
    }
  }

  return '';
};
