import axios, { type AxiosInstance } from 'axios';

export function createApiClient(baseURL = '/api'): AxiosInstance {
  const instance = axios.create({ baseURL });

  instance.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });

  instance.interceptors.response.use(
    (res) => res,
    (err) => {
      if (err.response?.status === 401 && !err.config.url?.includes('/auth/login')) {
        localStorage.removeItem('token');
        window.location.href = '/login';
      }
      return Promise.reject(err);
    },
  );

  return instance;
}

export async function get<T = any>(instance: AxiosInstance, url: string, params?: Record<string, unknown>): Promise<T> {
  const { data } = await instance.get(url, { params });
  return data;
}

export async function post<T = any>(instance: AxiosInstance, url: string, body?: Record<string, unknown>): Promise<T> {
  const { data } = await instance.post(url, body);
  return data;
}

export async function put<T = any>(instance: AxiosInstance, url: string, body?: Record<string, unknown>): Promise<T> {
  const { data } = await instance.put(url, body);
  return data;
}

export async function del<T = any>(instance: AxiosInstance, url: string): Promise<T> {
  const { data } = await instance.delete(url);
  return data;
}
