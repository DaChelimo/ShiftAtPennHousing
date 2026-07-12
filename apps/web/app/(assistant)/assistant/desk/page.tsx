import { AssistantChat } from '../AssistantChat';

// Desk-monitor layout: larger type, roomier tap targets, otherwise the same chat.
export default function DeskAssistantPage() {
  return (
    <div className="text-[1.05rem]">
      <AssistantChat surface="desk" desk />
    </div>
  );
}
