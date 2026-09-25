import { CONFIG_MANIFEST, CONFIG_SOLUTION_FILES } from './configuration.js'

const internalService = `apiVersion: v1
kind: Service
metadata:
  name: assistant-internal
  namespace: assistant
spec:
  type: ClusterIP
  selector:
    app: assistant
  ports:
    - protocol: TCP
      port: 80
      targetPort: http
`

const externalService = `apiVersion: v1
kind: Service
metadata:
  name: assistant-public
  namespace: assistant
spec:
  type: LoadBalancer
  selector:
    app: assistant
  ports:
    - protocol: TCP
      port: 80
      targetPort: http
`

const deployment = CONFIG_SOLUTION_FILES['k8s/deployment.yaml']
  .replace('acraksconfigguided.azurecr.io/assistant:starter', 'acraksnetworkguided.azurecr.io/assistant:starter\n          imagePullPolicy: Always')

export const CONNECTIVITY_MANIFEST = Object.freeze({
  ...CONFIG_MANIFEST,
  id: 'aks-python-connectivity-v1',
  files: [...CONFIG_MANIFEST.files.filter(path => path !== 'k8s/service.yaml'), 'k8s/service-internal.yaml', 'k8s/service-external.yaml'],
  kubernetesFiles: [...CONFIG_MANIFEST.kubernetesFiles.filter(path => path !== 'k8s/service.yaml'), 'k8s/service-internal.yaml', 'k8s/service-external.yaml'],
})

const { 'k8s/service.yaml': unusedService, ...configurationFiles } = CONFIG_SOLUTION_FILES

export const CONNECTIVITY_FILES = Object.freeze({
  ...configurationFiles,
  'k8s/deployment.yaml': deployment,
  'k8s/service-internal.yaml': `apiVersion: v1
kind: Service
metadata:
  name: assistant-internal
  namespace: assistant
spec:
  # Add a ClusterIP selector and port mapping for the supplied Pods.
`,
  'k8s/service-external.yaml': `apiVersion: v1
kind: Service
metadata:
  name: assistant-public
  namespace: assistant
spec:
  # Add a LoadBalancer selector and port mapping for the supplied Pods.
`,
})

export const CONNECTIVITY_SOLUTION_FILES = Object.freeze({
  ...CONNECTIVITY_FILES,
  'app.py': CONFIG_SOLUTION_FILES['app.py'].replace('PORT = 8080', 'PORT = 9090'),
  Dockerfile: CONFIG_SOLUTION_FILES.Dockerfile.replace('EXPOSE 8080', 'EXPOSE 9090'),
  'k8s/deployment.yaml': deployment.replace('assistant:starter', 'assistant:network-v1').replace('containerPort: 8080', 'containerPort: 9090'),
  'k8s/service-internal.yaml': internalService,
  'k8s/service-external.yaml': externalService,
})
