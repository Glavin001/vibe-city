'use client'

import dynamic from 'next/dynamic'

// Avoid SSR for three/rapier scene
const CraterHeightfieldDemo = dynamic(
  () =>
    import('../../components/CraterHeightfieldDemo').then(
      (mod) => mod.CraterHeightfieldDemoMemo
    ),
  { ssr: false }
)

export default function Page() {
  return <CraterHeightfieldDemo />
}


