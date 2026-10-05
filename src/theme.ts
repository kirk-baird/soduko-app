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
  // home screen
  heroBg: string;
  heroText: string;
  heroMuted: string;
  heroTrack: string;
  heroButton: string;
  heroButtonText: string;
  levelRamp: [string, string, string, string]; // Medium → Extreme
  pipEmpty: string;
  // variants
  cellShaded: string; // windoku windows
  clueBg: string; // kakuro clue/black cells
  clueLine: string;
  clueText: string;
  tree: string;
  tent: string;
  grass: string;
  countDone: string;
  countOver: string;
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
  heroBg: '#1F2A4D',
  heroText: '#F4F6FC',
  heroMuted: '#A9B3D1',
  heroTrack: '#34406A',
  heroButton: '#F4F6FC',
  heroButtonText: '#1F2A4D',
  levelRamp: ['#A9BDF0', '#6F8FE3', '#3A5CC7', '#1C2E86'],
  pipEmpty: '#E4DFD5',
  cellShaded: '#E3ECF8',
  clueBg: '#2A2C3F',
  clueLine: '#6B6F8A',
  clueText: '#F4F6FC',
  tree: '#2F7D4A',
  tent: '#C0662B',
  grass: '#9CC9A6',
  countDone: '#2F7D4A',
  countOver: '#CC3B30',
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
  heroBg: '#26314F',
  heroText: '#F4F6FC',
  heroMuted: '#A3ADCB',
  heroTrack: '#3A466E',
  heroButton: '#8DB4FF',
  heroButtonText: '#0F1320',
  levelRamp: ['#5468A8', '#6F8BDE', '#93ACF4', '#C7D4FF'],
  pipEmpty: '#30344A',
  cellShaded: '#24304A',
  clueBg: '#0E0F15',
  clueLine: '#4A4E66',
  clueText: '#D9DCEB',
  tree: '#5DBB7E',
  tent: '#F09A5B',
  grass: '#3E6B4C',
  countDone: '#5DBB7E',
  countOver: '#FF7B70',
};

export function useTheme(): Theme {
  const system = useColorScheme();
  const { settings } = useSettings();
  const mode = settings.theme === 'system' ? (system === 'dark' ? 'dark' : 'light') : settings.theme;
  return mode === 'dark' ? dark : light;
}
