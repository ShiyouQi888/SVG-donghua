import { createFileRoute } from "@tanstack/react-router";
import { Editor } from "@/components/animator/Editor";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <Editor />;
}
