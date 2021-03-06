import { LINK_ERRORS as LE } from '../editor/constants';

export const SUCCESSFULLY_PUBLISHED = {
  title: 'Library published',
};

export const LINK_ERRORS = {
  [LE.SAME_DIRECTION]: {
    title: 'Impossible link',
    note: 'Links between pins of the same direction are not allowed.',
    solution:
      'Try creating a link between an input (pin on top) and output (pin at bottom)',
    persistent: false,
  },
  [LE.INCOMPATIBLE_TYPES]: {
    title: 'Incompatible pin types',
    note: `No implicit cast exist to convert the output type to the input type.`,
    solution: 'Try to find a node for the conversion and place it as a medium.',
    persistent: false,
  },
};
