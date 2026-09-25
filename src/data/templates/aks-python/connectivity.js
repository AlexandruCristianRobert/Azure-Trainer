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

const independentDeployment = (namespace, configName, secretName) => `apiVersion: apps/v1
kind: Deployment
metadata:
  name: assistant
  namespace: ${namespace}
spec:
  replicas: 2
  selector:
    matchLabels:
      app: assistant
  template:
    metadata:
      labels:
        app: assistant
    spec:
      containers:
        - name: api
          image: acraksnetworkindependent.azurecr.io/assistant:shared
          imagePullPolicy: Always
          ports:
            - name: http
              containerPort: 8080
          env:
            - name: APP_ENV
              valueFrom:
                configMapKeyRef:
                  name: ${configName}
                  key: APP_ENV
            - name: AI_ENDPOINT
              valueFrom:
                configMapKeyRef:
                  name: ${configName}
                  key: AI_ENDPOINT
            - name: ANSWER_DEPLOYMENT
              valueFrom:
                configMapKeyRef:
                  name: ${configName}
                  key: ANSWER_DEPLOYMENT
            - name: EMBEDDING_DEPLOYMENT
              valueFrom:
                configMapKeyRef:
                  name: ${configName}
                  key: EMBEDDING_DEPLOYMENT
            - name: PGHOST
              valueFrom:
                configMapKeyRef:
                  name: ${configName}
                  key: PGHOST
            - name: PGDATABASE
              valueFrom:
                configMapKeyRef:
                  name: ${configName}
                  key: PGDATABASE
            - name: PGUSER
              valueFrom:
                configMapKeyRef:
                  name: ${configName}
                  key: PGUSER
            - name: COLLECTION
              valueFrom:
                configMapKeyRef:
                  name: ${configName}
                  key: COLLECTION
            - name: PGPASSWORD
              valueFrom:
                secretKeyRef:
                  name: ${secretName}
                  key: PGPASSWORD
          volumeMounts:
            - name: settings
              mountPath: /etc/assistant
              readOnly: true
      volumes:
        - name: settings
          configMap:
            name: ${configName}
            items:
              - key: settings.json
                path: settings.json
`
const independentConfig = (namespace, environment, collection, displayName) => `apiVersion: v1
kind: ConfigMap
metadata:
  name: assistant-config
  namespace: ${namespace}
data:
  APP_ENV: ${environment}
  AI_ENDPOINT: https://ai-${collection}.example
  ANSWER_DEPLOYMENT: answers-v1
  EMBEDDING_DEPLOYMENT: embeddings-v1
  COLLECTION: ${collection}
  PGHOST: pg-${collection}.example
  PGDATABASE: knowledge
  PGUSER: assistant_${collection}
  settings.json: |
    {"display_name":"${displayName}","response_prefix":""}
`
const independentService = (namespace, name, type, port) => `apiVersion: v1
kind: Service
metadata:
  name: ${name}
  namespace: ${namespace}
spec:
  type: ${type}
  selector:
    app: assistant
  ports:
    - protocol: TCP
      port: ${port}
      targetPort: http
`
const independentSecret = (namespace, name, password) => `apiVersion: v1
kind: Secret
metadata:
  name: ${name}
  namespace: ${namespace}
type: Opaque
stringData:
  PGPASSWORD: ${password}
`

export const CONNECTIVITY_INDEPENDENT_MANIFEST = Object.freeze({
  ...CONNECTIVITY_MANIFEST,
  id: 'aks-python-connectivity-independent-v1',
  files: ['app.py', 'server.py', 'training_runtime.py', 'Dockerfile', 'k8s/primary-namespace.yaml', 'k8s/primary-configmap.yaml', 'k8s/primary-secret.yaml', 'k8s/primary-deployment.yaml', 'k8s/primary-service-internal.yaml', 'k8s/primary-service-external.yaml', 'k8s/review-namespace.yaml', 'k8s/review-configmap.yaml', 'k8s/review-secret.yaml', 'k8s/review-deployment.yaml', 'k8s/review-service-internal.yaml', 'k8s/review-service-external.yaml'],
  kubernetesFiles: ['k8s/primary-namespace.yaml', 'k8s/primary-configmap.yaml', 'k8s/primary-secret.yaml', 'k8s/primary-deployment.yaml', 'k8s/primary-service-internal.yaml', 'k8s/primary-service-external.yaml', 'k8s/review-namespace.yaml', 'k8s/review-configmap.yaml', 'k8s/review-secret.yaml', 'k8s/review-deployment.yaml', 'k8s/review-service-internal.yaml', 'k8s/review-service-external.yaml'],
})

const primaryConfig = independentConfig('primary', 'production', 'training', 'Primary assistant')
const reviewConfig = independentConfig('review', 'review', 'review', 'Review assistant')
export const CONNECTIVITY_INDEPENDENT_FILES = Object.freeze({
  'app.py': CONNECTIVITY_FILES['app.py'], 'server.py': CONNECTIVITY_FILES['server.py'], 'training_runtime.py': CONNECTIVITY_FILES['training_runtime.py'], Dockerfile: CONNECTIVITY_FILES.Dockerfile,
  'k8s/primary-namespace.yaml': 'apiVersion: v1\nkind: Namespace\nmetadata:\n  name: primary\n',
  'k8s/primary-configmap.yaml': primaryConfig,
  'k8s/primary-secret.yaml': independentSecret('primary', 'assistant-credentials', 'training-only-password'),
  'k8s/primary-deployment.yaml': independentDeployment('primary', 'assistant-config', 'assistant-credentials'),
  'k8s/primary-service-internal.yaml': independentService('primary', 'assistant-internal', 'ClusterIP', 8080),
  'k8s/primary-service-external.yaml': independentService('primary', 'assistant-public', 'LoadBalancer', 80),
  'k8s/review-namespace.yaml': 'apiVersion: v1\nkind: Namespace\nmetadata:\n  name: review\n',
  'k8s/review-configmap.yaml': reviewConfig,
  'k8s/review-secret.yaml': independentSecret('review', 'assistant-credentials', 'review-only-password'),
  'k8s/review-deployment.yaml': independentDeployment('review', 'assistant-config', 'assistant-credentials'),
  'k8s/review-service-internal.yaml': 'apiVersion: v1\nkind: Service\nmetadata:\n  name: assistant-internal\n  namespace: review\n',
  'k8s/review-service-external.yaml': 'apiVersion: v1\nkind: Service\nmetadata:\n  name: assistant-public\n  namespace: review\n',
})
export const CONNECTIVITY_INDEPENDENT_SOLUTION_FILES = Object.freeze({ ...CONNECTIVITY_INDEPENDENT_FILES,
  'k8s/review-service-internal.yaml': independentService('review', 'assistant-internal', 'ClusterIP', 8080),
  'k8s/review-service-external.yaml': independentService('review', 'assistant-public', 'LoadBalancer', 80),
})
