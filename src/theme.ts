import { useColorScheme } from 'react-native';
import { useSettings } from './settings';

export interface Theme {
  dark: boolean;
  bg: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  textMuted: string;
  accent: string;
  accentText: string;
  border: string;
  // board
  lineThick: string;
  lineThin: string;
  cell: string;
  cellGiven: string;
  cellPeer: string;
  cellPeerGiven: string;
  cellSame: string;
  cellSelected: string;
  cellError: string;
  digitGiven: string;
  digitUser: string;
  digitError: string;
  pencil: string;
  pencilMatchBg: string;
  pencilMatchText: string;
  // hints
  hintPattern: string;
  hintKey: string;
  hintKeyAlt: string;
  hintElim: string;
  hintElimText: string;
  hintPlace: string;
}

const light: Theme = {
  dark: false,
  bg: '#F5F2EC',
  surface: '#FFFFFF',
  surfaceAlt: '#ECE7DE',
  text: '#1E2030',
  textMuted: '#6B6E80',
  accent: '#3561B0',
  accentText: '#FFFFFF',
  border: '#DAD5CB',
  lineThick: '#2A2C3F',
  lineThin: '#CFCAC0',
  cell: '#FFFFFF',
  cellGiven: '#EDE8DE',
  cellPeer: '#E7EDF7',
  cellPeerGiven: '#D9E0EC',
  cellSame: '#C3D5F2',
  cellSelected: '#9FBDEB',
  cellError: '#FBE1DE',
  digitGiven: '#1E2030',
  digitUser: '#2E5DB0',
  digitError: '#CC3B30',
  pencil: '#5E6274',
  pencilMatchBg: '#3561B0',
  pencilMatchText: '#FFFFFF',
  hintPattern: '#FFF0C2',
  hintKey: '#8FDBA4',
  hintKeyAlt: '#F5B971',
  hintElim: '#F6BDB7',
  hintElimText: '#B3261E',
  hintPlace: '#BDECC9',
};

const dark: Theme = {
  dark: true,
  bg: '#14151C',
  surface: '#1E2029',
  surfaceAlt: '#282B37',
  text: '#ECEDF3',
  textMuted: '#9A9DB0',
  accent: '#6E9BEA',
  accentText: '#0F1320',
  border: '#33364A',
  lineThick: '#8C90A8',
  lineThin: '#383B4D',
  cell: '#1E2029',
  cellGiven: '#2A2C38',
  cellPeer: '#252C3D',
  cellPeerGiven: '#2E3546',
  cellSame: '#2F4166',
  cellSelected: '#3D5A92',
  cellError: '#4A2626',
  digitGiven: '#ECEDF3',
  digitUser: '#8DB4FF',
  digitError: '#FF7B70',
  pencil: '#A3A7BA',
  pencilMatchBg: '#6E9BEA',
  pencilMatchText: '#0F1320',
  hintPattern: '#4A4123',
  hintKey: '#2F7A47',
  hintKeyAlt: '#9A6424',
  hintElim: '#7A2D29',
  hintElimText: '#FFB4AB',
  hintPlace: '#2C5E3A',
};

export function useTheme(): Theme {
  const system = useColorScheme();
  const { settings } = useSettings();
  const mode = settings.theme === 'system' ? (system === 'dark' ? 'dark' : 'light') : settings.theme;
  return mode === 'dark' ? dark : light;
}
