import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, LayoutDashboard, Plus, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { PageHeader } from '@/components/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  CARD_SIZES,
  DEFAULT_LAYOUT,
  WORKBENCH_CARDS,
  useWorkbenchLayout,
  type CardSize,
  type WorkbenchCard,
  type WorkbenchCardId,
  type WorkbenchLayout,
} from '@/lib/workbench';

const SIZE_CLASSES: Record<CardSize, string> = {
  sm: 'lg:col-span-1',
  md: 'lg:col-span-2',
  lg: 'lg:col-span-3',
};

const SIZE_NAMES: Record<CardSize, string> = { sm: '小', md: '中', lg: '大' };

export type WorkbenchCardContent = { title: string; content: ReactNode };

type WorkbenchProps = {
  userId: string;
  tenantId: string;
  description: string;
  /** Null for a card the account may not have, which is then neither shown nor offered. */
  cards: Record<WorkbenchCardId, WorkbenchCardContent | null>;
};

function defaultSize(id: WorkbenchCardId): CardSize {
  return DEFAULT_LAYOUT.find((card) => card.id === id)?.size ?? 'md';
}

function sameLayout(one: WorkbenchLayout, other: WorkbenchLayout): boolean {
  return JSON.stringify(one) === JSON.stringify(other);
}

/**
 * The home page's cards, which each account arranges for itself: which to show, in what order
 * and how wide. Changes are made on a draft and kept only when the user is done.
 */
export function Workbench({ userId, tenantId, description, cards }: WorkbenchProps) {
  const [stored, save] = useWorkbenchLayout(userId, tenantId);
  const [draft, setDraft] = useState<WorkbenchLayout | null>(null);
  const allowed = (layout: WorkbenchLayout) => layout.filter((card) => cards[card.id]);
  const shown = allowed(draft ?? stored);
  const defaults = allowed(DEFAULT_LAYOUT);
  const hidden = WORKBENCH_CARDS.filter((id) => cards[id] && !shown.some((card) => card.id === id));
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const titleOf = (id: UniqueIdentifier) => cards[id as WorkbenchCardId]?.title ?? '';
  // Over is the dragged card itself when it is picked up, so name places rather than cards.
  const placeOf = (id: UniqueIdentifier) =>
    `第 ${shown.findIndex((card) => card.id === id) + 1} 个位置，共 ${shown.length} 个`;
  const announcements: Announcements = {
    onDragStart: ({ active }) => `拿起了「${titleOf(active.id)}」，在${placeOf(active.id)}`,
    onDragOver: ({ active, over }) =>
      over ? `「${titleOf(active.id)}」现在在${placeOf(over.id)}` : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? `「${titleOf(active.id)}」放在了${placeOf(over.id)}`
        : `放下了「${titleOf(active.id)}」`,
    onDragCancel: ({ active }) => `取消拖动，「${titleOf(active.id)}」回到原位`,
  };

  const update = (change: (draft: WorkbenchLayout) => WorkbenchLayout) =>
    setDraft((current) => current && change(current));

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) {
      return;
    }
    update((current) =>
      arrayMove(
        current,
        current.findIndex((card) => card.id === active.id),
        current.findIndex((card) => card.id === over.id),
      ),
    );
  };

  const finish = () => {
    if (draft) {
      save(sameLayout(shown, defaults) ? null : shown);
    }
    setDraft(null);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="工作台"
        description={description}
        actions={
          draft ? (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger
                  className={buttonVariants({ variant: 'outline' })}
                  disabled={hidden.length === 0}
                >
                  <Plus />
                  添加卡片
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {hidden.map((id) => (
                    <DropdownMenuItem
                      key={id}
                      onClick={() =>
                        update((current) => [...current, { id, size: defaultSize(id) }])
                      }
                    >
                      {titleOf(id)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="ghost" onClick={() => setDraft(defaults)}>
                恢复默认
              </Button>
              <Button variant="outline" onClick={() => setDraft(null)}>
                取消
              </Button>
              <Button onClick={finish}>完成</Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => setDraft(shown)}>
              <LayoutDashboard />
              编辑工作台
            </Button>
          )
        }
      />

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable:
              '按空格键或回车键拿起卡片，用方向键移动，再按空格键或回车键放下，按 Esc 取消。',
          },
        }}
      >
        <SortableContext items={shown.map((card) => card.id)} strategy={rectSortingStrategy}>
          <div className="grid items-start gap-6 lg:grid-cols-3">
            {shown.map((card) => (
              <SortableCard
                key={card.id}
                card={card}
                title={titleOf(card.id)}
                editing={draft !== null}
                onResize={(size) =>
                  update((current) =>
                    current.map((item) => (item.id === card.id ? { ...item, size } : item)),
                  )
                }
                onRemove={() => update((current) => current.filter((item) => item.id !== card.id))}
              >
                {cards[card.id]?.content}
              </SortableCard>
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {shown.length === 0 && (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {draft
            ? '工作台上没有卡片了，点「添加卡片」加回来。'
            : '工作台上没有卡片，点「编辑工作台」添加。'}
        </div>
      )}
    </div>
  );
}

type SortableCardProps = {
  card: WorkbenchCard;
  title: string;
  editing: boolean;
  onResize: (size: CardSize) => void;
  onRemove: () => void;
  children: ReactNode;
};

function SortableCard({ card, title, editing, onResize, onRemove, children }: SortableCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id, disabled: !editing });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(SIZE_CLASSES[card.size], isDragging && 'relative z-10 opacity-80')}
    >
      {editing && (
        <div className="mb-2 flex items-center gap-1 rounded-lg border border-dashed bg-muted/40 p-1">
          <Button
            ref={setActivatorNodeRef}
            variant="ghost"
            size="icon-sm"
            className="cursor-grab touch-none"
            aria-label={`拖动「${title}」`}
            {...attributes}
            {...listeners}
          >
            <GripVertical />
          </Button>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
          <div role="group" aria-label={`「${title}」的大小`} className="flex">
            {CARD_SIZES.map((size) => (
              <Button
                key={size}
                variant={card.size === size ? 'secondary' : 'ghost'}
                size="sm"
                aria-pressed={card.size === size}
                onClick={() => onResize(size)}
              >
                {SIZE_NAMES[size]}
              </Button>
            ))}
          </div>
          <Button variant="ghost" size="icon-sm" aria-label={`移除「${title}」`} onClick={onRemove}>
            <X />
          </Button>
        </div>
      )}
      <div inert={editing}>{children}</div>
    </div>
  );
}
