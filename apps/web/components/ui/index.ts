// Shared component layer (Carbon-flavored) for the admin web app.
// Faithful TS/React port of apps/web/design/admin-web.html's atom set.
// See apps/web/design/DESIGN_TOKENS.md for the token + state contract.

export { Icon, ICONS, type IconName } from './Icon';
export { Button, IconButton, type ButtonKind, type ButtonSize } from './Button';
export { Tag, PickupDot, type TagKind } from './Tag';
export { Avatar } from './Avatar';
export {
  EscalationChip,
  ESCALATION_STEPS,
  type EscalationStep,
} from './EscalationChip';
export { Toggle } from './Toggle';
export { Field, TextInput, DateInput, Select } from './Field';
export { ComboBox, type ComboOption } from './ComboBox';
export { Modal } from './Modal';
export { Notification, type NotificationKind } from './Notification';
export { EmptyState, ErrorState, type EmptyTone } from './EmptyState';
export { Skeleton } from './Skeleton';
export { Tabs, type TabItem } from './Tabs';
export { PageHead } from './PageHead';
export { Card } from './Card';
export { DataTable, type Column } from './DataTable';
export { StatusLegend } from './StatusLegend';
export {
  SHIFT_STATES,
  SHIFT_STATE_BY_KEY,
  type ShiftStateKey,
  type ShiftStateMeta,
} from './shiftState';
export { ToastProvider, useToast, type ToastKind, type ToastInput } from './Toast';
