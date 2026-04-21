declare module "arabic-persian-reshaper" {
  export default function reshape(input: string): string;
}

declare module "bidi-js" {
  const bidi: {
    from_string: (input: string) => string;
  };
  export default bidi;
}

