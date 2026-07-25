import {
  BookBookmark,
  Broadcast,
  CloudArrowDown,
  Code,
  Columns,
  Eye,
  GearSix,
  GlobeSimple,
  Key,
  Lightning,
  Link,
  ListNumbers,
  LockKey,
  MapPin,
  MathOperations,
  Package,
  PuzzlePiece,
  ShieldCheck,
  Sliders,
  Stack,
  Table,
  Tag,
  TreeStructure,
  Waves
} from '@phosphor-icons/react'
import type { ObjectGroupKey, TableGroupKey } from '../stores/useSidebarStore'

export function getObjectGroupIcon(key: ObjectGroupKey) {
  switch (key) {
    case 'views':
      return <Eye weight="duotone" className="tree-icon icon-view" />
    case 'materializedViews':
      return <Stack weight="duotone" className="tree-icon icon-matview" />
    case 'procedures':
      return <GearSix weight="duotone" className="tree-icon icon-procedure" />
    case 'functions':
      return <MathOperations weight="duotone" className="tree-icon icon-function" />
    case 'sequences':
      return <ListNumbers weight="duotone" className="tree-icon icon-sequence" />
    case 'extensions':
      return <PuzzlePiece weight="duotone" className="tree-icon icon-extension" />
    case 'types':
      return <TreeStructure weight="duotone" className="tree-icon icon-type" />
    case 'domains':
      return <GlobeSimple weight="duotone" className="tree-icon icon-domain" />
    case 'foreignTables':
      return <CloudArrowDown weight="duotone" className="tree-icon icon-foreign" />
    case 'packages':
      return <Package weight="duotone" className="tree-icon icon-package" />
    case 'synonyms':
      return <Link weight="duotone" className="tree-icon icon-synonym" />
    case 'events':
      return <Lightning weight="duotone" className="tree-icon icon-event" />
    case 'dictionaries':
      return <BookBookmark weight="duotone" className="tree-icon icon-dictionary" />
    case 'aliases':
      return <Tag weight="duotone" className="tree-icon icon-alias" />
    case 'dataStreams':
      return <Waves weight="duotone" className="tree-icon icon-stream" />
    case 'mappings':
      return <MapPin weight="duotone" className="tree-icon icon-mapping" />
    case 'indexes':
      return <Sliders weight="duotone" className="tree-icon icon-index" />
    case 'triggers':
      return <Broadcast weight="duotone" className="tree-icon icon-trigger" />
    default:
      return <Code weight="duotone" className="tree-icon" />
  }
}

export function getTableGroupIcon(key: TableGroupKey) {
  switch (key) {
    case 'columns':
      return <Columns weight="duotone" className="tree-icon icon-column" />
    case 'indexes':
      return <Sliders weight="duotone" className="tree-icon icon-index" />
    case 'foreignKeys':
      return <Key weight="duotone" className="tree-icon icon-key" />
    case 'triggers':
      return <Broadcast weight="duotone" className="tree-icon icon-trigger" />
    case 'checks':
      return <ShieldCheck weight="duotone" className="tree-icon icon-check" />
    case 'policies':
      return <LockKey weight="duotone" className="tree-icon icon-policy" />
    default:
      return <Code weight="duotone" className="tree-icon" />
  }
}

export function getTableIcon() {
  return <Table weight="duotone" className="tree-icon table-icon" />
}
