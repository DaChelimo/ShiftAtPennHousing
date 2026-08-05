/**
 * The §5 component set, made available to every MDX page without an import.
 * Authors write content; the design system is ambient.
 */
import Callout from './components/Callout.astro';
import Card from './components/Card.astro';
import CardGrid from './components/CardGrid.astro';
import Figure from './components/Figure.astro';
import FlowStrip from './components/FlowStrip.astro';
import Ladder from './components/Ladder.astro';
import Link from './components/Link.astro';
import Related from './components/Related.astro';
import RoleCard from './components/RoleCard.astro';
import StateCard from './components/StateCard.astro';
import StateList from './components/StateList.astro';
import Steps from './components/Steps.astro';
import Table from './components/Table.astro';
import Tabs from './components/Tabs.astro';
import Term from './components/Term.astro';
import UI from './components/UI.astro';

export const mdxComponents = {
  // Raw anchors in a page go through Link so root-absolute hrefs pick up the
  // site's base path (/guide). See src/href.ts.
  a: Link,
  Link,
  Callout,
  Card,
  CardGrid,
  Figure,
  FlowStrip,
  Ladder,
  Related,
  RoleCard,
  StateCard,
  StateList,
  Steps,
  Table,
  Tabs,
  Term,
  UI,
};
