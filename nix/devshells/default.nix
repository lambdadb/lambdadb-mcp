{ pkgs }:

pkgs.mkShell {
  packages = with pkgs; [
    nodejs_20
    nodePackages.npm
  ];

  shellHook = ''
    export PATH="$PWD/node_modules/.bin:$PATH"
    echo "lambdadb-mcp dev shell ready"
    echo "node: $(node --version)"
    echo "npm: $(npm --version)"
  '';
}

